import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { botState } from "./bot/state";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── 9Router OAuth-style connect flow ──────────────────────────────────────
const CONNECT_PAGE = path.join(__dirname, "connect-page.html");

app.get("/connect/9router", (req: Request, res: Response) => {
  const redirect = String(req.query["redirect"] ?? "");
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
    .replace(/\{\{ERROR_MSG\}\}/g, errorMsg);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/connect/9router/authorize", async (req: Request, res: Response) => {
  const body = req.body as { baseUrl?: string; apiKey?: string; model?: string; redirect?: string };
  const { baseUrl, apiKey, model, redirect } = body;

  if (!baseUrl || !apiKey) {
    res.status(400).send("Thieu Base URL hoac API Key.");
    return;
  }

  // Test connection before saving
  try {
    const testUrl = baseUrl.replace(/\/+$/, "") + "/models";
    const testRes = await fetch(testUrl, {
      headers: { Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(8000),
    } as RequestInit & { signal: AbortSignal });
    if (!testRes.ok) throw new Error("HTTP " + testRes.status);
  } catch (err: any) {
    const errMsg = encodeURIComponent(err?.message ?? "Ket noi that bai");
    res.redirect(
      "/connect/9router?redirect=" +
        encodeURIComponent(redirect ?? "") +
        "&error=" +
        errMsg
    );
    return;
  }

  botState.aiBaseUrl = baseUrl.trim();
  botState.aiApiKey = apiKey.trim();
  if (model && model.trim()) botState.aiModel = model.trim();
  logger.info(
    { baseUrl: botState.aiBaseUrl, model: botState.aiModel },
    "9Router authorized via connect flow"
  );

  const target =
    redirect && redirect.startsWith("http")
      ? redirect +
        (redirect.includes("?") ? "&" : "?") +
        "connected=1&model=" +
        encodeURIComponent(botState.aiModel)
      : "/";
  res.redirect(target);
});

// When DASHBOARD_DIST is set (production/Railway), serve the built dashboard
// as static files and fall back to index.html for SPA routing.
const dashboardDist = process.env.DASHBOARD_DIST;
if (dashboardDist && fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}

export default app;