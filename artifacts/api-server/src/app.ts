import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { botState } from "./bot/state";
import { ADMIN_TOKEN, requireAdmin, getUserToken, getAiAccount, markUserTokenUsed,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GEMINI_BASE_URL, GEMINI_DEFAULT_MODEL,
  createOAuthState, consumeOAuthState } from "./lib/adminAuth";

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

const LANDING_PAGE = path.join(__dirname, "landing.html");
const CONNECT_PAGE = path.join(__dirname, "connect-page.html");

// ── Landing page ─────────────────────────────────────────────────────────────
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  if (fs.existsSync(LANDING_PAGE)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(LANDING_PAGE);
  } else {
    next();
  }
});

// ── Google Gemini OAuth flow ──────────────────────────────────────────────────
const GEMINI_SCOPES = "https://www.googleapis.com/auth/generative-language";

app.get("/connect/gemini", (req: Request, res: Response) => {
  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = ADMIN_TOKEN && adminCookie === ADMIN_TOKEN;
  if (!isAdmin) { res.status(401).send("Yeu cau dang nhap admin."); return; }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(503).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:1rem;padding:2rem;text-align:center">
      <h2 style="color:#f87171">&#x26A0; Chua cau hinh Google OAuth</h2>
      <p>Can them vao Railway environment variables:</p>
      <code style="background:#1a1d27;padding:.75rem 1.5rem;border-radius:8px;font-size:.9rem;display:block;text-align:left">GOOGLE_CLIENT_ID=...<br>GOOGLE_CLIENT_SECRET=...</code>
      <p style="color:#64748b;font-size:.85rem;max-width:480px">Tao tai: <strong style="color:#818cf8">console.cloud.google.com</strong> &rarr; APIs &amp; Services &rarr; Credentials &rarr; Create OAuth 2.0 Client ID<br>Redirect URI: <strong>${req.protocol}://${req.get("host")}/connect/gemini/callback</strong></p>
      <a href="/admin" style="color:#6366f1;text-decoration:none">&larr; Quay lai Admin</a>
    </body></html>`);
    return;
  }

  const state = createOAuthState(true);
  const redirectUri = `${req.protocol}://${req.get("host")}/connect/gemini/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GEMINI_SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/connect/gemini/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) { res.redirect(`/admin?geminiErr=${encodeURIComponent(error)}`); return; }

  const stateData = consumeOAuthState(state ?? "");
  if (!stateData) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send("OAuth state khong hop le hoac het han. <a href='/admin'>Quay lai</a>");
    return;
  }

  if (!code) { res.redirect("/admin?geminiErr=no_code"); return; }

  const redirectUri = `${req.protocol}://${req.get("host")}/connect/gemini/callback`;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    } as RequestInit & { signal: AbortSignal });

    if (!tokenRes.ok) throw new Error(`Token exchange HTTP ${tokenRes.status}: ${await tokenRes.text()}`);

    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token?: string;
      expires_in: number; token_type: string;
    };
    if (!tokens.access_token) throw new Error("Khong co access_token trong response");

    // Gemini OpenAI-compatible endpoint uses OAuth Bearer token as API key
    botState.aiBaseUrl = GEMINI_BASE_URL;
    botState.aiApiKey = tokens.access_token;
    botState.aiModel = GEMINI_DEFAULT_MODEL;
    if (tokens.refresh_token) {
      (botState as any)._geminiRefreshToken = tokens.refresh_token;
      (botState as any)._geminiTokenExpiry = Date.now() + tokens.expires_in * 1000;
    }

    logger.info({ model: botState.aiModel }, "Gemini connected via OAuth");
    res.redirect("/admin?geminiOk=1");
  } catch (err: any) {
    logger.error({ err: err?.message }, "Gemini OAuth callback failed");
    res.redirect(`/admin?geminiErr=${encodeURIComponent(err?.message ?? "unknown")}`);
  }
});



app.get("/connect/9router", (req: Request, res: Response) => {
  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = ADMIN_TOKEN && adminCookie === ADMIN_TOKEN;
  const userTokenId = req.query["userToken"] as string | undefined;

  if (!isAdmin) {
    if (!userTokenId) { res.status(403).send("Truy cap bi tu choi. Can co link do admin cap."); return; }
    const ut = getUserToken(userTokenId);
    if (!ut) { res.status(403).send("Link khong hop le hoac da het han."); return; }
    if (ut.expiresAt < Date.now()) { res.status(403).send("Link da het han."); return; }
    if (ut.usedAt) { res.status(403).send("Link nay da duoc su dung roi."); return; }
  }

  const ut = userTokenId ? getUserToken(userTokenId) : undefined;
  const redirect = String(req.query["redirect"] ?? ut?.redirectUrl ?? "");
  const accountLabel = ut?.label ?? "Admin";

  // Build account block
  let accountBlock = "";
  if (ut?.aiAccountId) {
    const acc = getAiAccount(ut.aiAccountId);
    if (acc) {
      accountBlock = `<div class="acct-card">
        <div class="acct-avatar">&#x1F916;</div>
        <div class="acct-info">
          <div class="acct-name">${acc.name}</div>
          <div class="acct-sub">Tai khoan AI duoc cap quyen</div>
          <div class="acct-model">${acc.model}</div>
        </div>
      </div>`;
    } else {
      accountBlock = `<div style="color:#f87171;font-size:13px;margin-bottom:16px;">Tai khoan AI khong ton tai hoac da bi xoa.</div>`;
    }
  } else if (isAdmin) {
    // Admin flow without pre-set account — show current config
    accountBlock = `<div class="acct-card">
      <div class="acct-avatar">&#x1F916;</div>
      <div class="acct-info">
        <div class="acct-name">Admin config hien tai</div>
        <div class="acct-sub">Ket noi voi cau hinh dang hoat dong</div>
        <div class="acct-model">${botState.aiModel || "chua cau hinh"}</div>
      </div>
    </div>`;
  }

  let html = fs.readFileSync(CONNECT_PAGE, "utf8");
  html = html
    .replace(/\{\{REDIRECT\}\}/g, redirect)
    .replace(/\{\{USER_TOKEN\}\}/g, userTokenId ?? "")
    .replace(/\{\{ACCOUNT_LABEL\}\}/g, accountLabel)
    .replace(/\{\{ACCOUNT_BLOCK\}\}/g, accountBlock);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/connect/9router/authorize", async (req: Request, res: Response) => {
  const body = req.body as { redirect?: string; userToken?: string };
  const { redirect, userToken: userTokenId } = body;

  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = ADMIN_TOKEN && adminCookie === ADMIN_TOKEN;

  if (!isAdmin) {
    if (!userTokenId) { res.status(403).send("Khong co quyen."); return; }
    const ut = getUserToken(userTokenId);
    if (!ut || ut.expiresAt < Date.now() || ut.usedAt) {
      res.status(403).send("Link het han hoac da dung roi."); return;
    }
  }

  const ut = userTokenId ? getUserToken(userTokenId) : undefined;

  // Resolve AI config: from linked account (user flow) or existing botState (admin)
  let baseUrl = botState.aiBaseUrl;
  let apiKey = botState.aiApiKey;
  let model = botState.aiModel;

  if (ut?.aiAccountId) {
    const acc = getAiAccount(ut.aiAccountId);
    if (!acc) { res.status(400).send("Tai khoan AI duoc gan vao link nay khong ton tai."); return; }
    baseUrl = acc.baseUrl;
    apiKey = acc.apiKey;
    model = acc.model;
  }

  if (!baseUrl || !apiKey) {
    res.status(400).send("Chua co cau hinh AI. Admin can them AI Account truoc.");
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
    res.redirect("/connect/9router?redirect=" + encodeURIComponent(redirect ?? "") + utParam + "&error=" + errMsg);
    return;
  }

  // Apply
  botState.aiBaseUrl = baseUrl;
  botState.aiApiKey = apiKey;
  botState.aiModel = model;
  if (userTokenId) markUserTokenUsed(userTokenId, ut?.label);

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