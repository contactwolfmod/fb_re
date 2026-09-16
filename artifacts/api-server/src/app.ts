import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { botState } from "./bot/state";
import { ADMIN_TOKEN, requireAdmin, getUserToken, markUserTokenUsed } from "./lib/adminAuth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// ---- /admin routes (non-API HTML pages, already inside router above) ----
// Already handled by adminRouter via /api? No: admin pages are NOT under /api.
// We mount the admin router directly on app too so /admin/* works without /api prefix.
import adminRouterDirect from "./routes/admin";
app.use(adminRouterDirect);

// ── 9Router connect flow (public for admin, token-gated for users) ────────────────
const CONNECT_PAGE = path.join(__dirname, "connect-page.html");

app.get("/connect/9router", (req: Request, res: Response) => {
  // Admin bypass: has valid adminToken cookie
  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = ADMIN_TOKEN && adminCookie === ADMIN_TOKEN;

  // User token gate
  const userTokenId = req.query["userToken"] as string | undefined;
  if (!isAdmin) {
    if (!userTokenId) {
      res.status(403).send("Truy cap bi tu choi. Can co link do admin cap.");
      return;
    }
    const ut = getUserToken(userTokenId);
    if (!ut) {
      res.status(403).send("Link khong hop le hoac da het han.");
      return;
    }
    if (ut.expiresAt < Date.now()) {
      res.status(403).send("Link da het han.");
      return;
    }
    if (ut.usedAt) {
      res.status(403).send("Link nay da duoc su dung roi.");
      return;
    }
  }

  const redirect = String(req.query["redirect"] ?? (isAdmin ? "" : (getUserToken(userTokenId!)?.redirectUrl ?? "")));
  const errorMsg = String(req.query["error"] ?? "");
  const defaultBase =
    botState.aiBaseUrl ||
    process.env["AI_BASE_URL"] ||
    "http://localhost:20128/v1";

  let html = fs.readFileSync(CONNECT_PAGE, "utf8");
  html = html
    .replace(/\{\{REDIRECT\}\}/g, redirect)
    .replace(/\{\{BASE_URL_HINT\}\}/g, defaultBase)
    .replace(/\{\{BASE_URL_DEFAULT\}\}/g, defaultBase)
    .replace(/\{\{ERROR_MSG\}\}/g, errorMsg)
    .replace(/\{\{USER_TOKEN\}\}/g, userTokenId ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/connect/9router/authorize", async (req: Request, res: Response) => {
  const body = req.body as { baseUrl?: string; apiKey?: string; model?: string; redirect?: string; userToken?: string };
  const { baseUrl, apiKey, model, redirect, userToken: userTokenId } = body;

  // Auth check
  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = ADMIN_TOKEN && adminCookie === ADMIN_TOKEN;
  if (!isAdmin) {
    if (!userTokenId) {
      res.status(403).send("Khong co quyen.");
      return;
    }
    const ut = getUserToken(userTokenId);
    if (!ut || ut.expiresAt < Date.now() || ut.usedAt) {
      res.status(403).send("Link het han hoac da dung roi.");
      return;
    }
  }

  if (!baseUrl || !apiKey) {
    res.status(400).send("Thieu Base URL hoac API Key.");
    return;
  }

  // Test connection
  try {
    const testUrl = baseUrl.replace(/\/+$/, "") + "/models";
    const testRes = await fetch(testUrl, {
      headers: { Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(8000),
    } as RequestInit & { signal: AbortSignal });
    if (!testRes.ok) throw new Error("HTTP " + testRes.status);
  } catch (err: any) {
    const errMsg = encodeURIComponent(err?.message ?? "Ket noi that bai");
    const utParam = userTokenId ? `&userToken=${userTokenId}` : "";
    res.redirect(
      "/connect/9router?redirect=" +
        encodeURIComponent(redirect ?? "") +
        utParam +
        "&error=" + errMsg
    );
    return;
  }

  // Save
  botState.aiBaseUrl = baseUrl.trim();
  botState.aiApiKey = apiKey.trim();
  if (model && model.trim()) botState.aiModel = model.trim();
  if (userTokenId) markUserTokenUsed(userTokenId);

  logger.info({ baseUrl: botState.aiBaseUrl, model: botState.aiModel }, "9Router authorized");

  const target =
    redirect && redirect.startsWith("http")
      ? redirect + (redirect.includes("?") ? "&" : "?") + "connected=1&model=" + encodeURIComponent(botState.aiModel)
      : "/admin";
  res.redirect(target);
});

// ── Dashboard SPA static files ───────────────────────────────────────────────────────────
const dashboardDist = process.env.DASHBOARD_DIST;
if (dashboardDist && fs.existsSync(dashboardDist)) {
  // SPA itself is behind admin gate (the HTML cookie check happens client side;
  // actual API calls are blocked by requireAdmin above)
  app.use(express.static(dashboardDist));
  app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}

export default app;