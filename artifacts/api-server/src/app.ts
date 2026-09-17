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
  createOAuthState, consumeOAuthState, setUserAiConfig, getSessionUser,
  fetchGeminiModels, updateUserAiModel } from "./lib/adminAuth";

const app: Express = express();

// Railway terminates TLS at its edge proxy and forwards plain HTTP to this
// container. Without trusting that proxy, Express's req.protocol/req.secure
// always report "http"/false even on a public https:// request — which broke
// the Google OAuth redirect_uri (built from req.protocol) and made session
// cookies never get the Secure flag. Trust the first hop so both reflect the
// real client-facing scheme.
app.set("trust proxy", 1);

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
import userRouter from "./routes/user";
app.use(adminRouterDirect);
app.use(userRouter);

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

app.get("/connect/gemini", async (req: Request, res: Response) => {
  const adminCookie = (req as any).cookies?.["adminToken"] as string | undefined;
  const isAdmin = !!(ADMIN_TOKEN && adminCookie === ADMIN_TOKEN);
  const userTokenId = req.query["userToken"] as string | undefined;
  const serviceUser = await getSessionUser((req as any).cookies?.userSession);
  const ut = userTokenId ? await getUserToken(userTokenId) : undefined;

  // Validate access: admin, logged-in service user, or legacy one-time link
  if (!isAdmin && !serviceUser) {
    if (!userTokenId) { res.status(401).send("Yeu cau dang nhap admin hoac co link hop le."); return; }
    if (!ut || ut.expiresAt < Date.now() || ut.usedAt) {
      res.status(403).send("Link het han hoac da duoc su dung roi."); return;
    }
    // User token must have fbThreadId for Gemini flow
    if (!ut.fbThreadId) {
      res.status(400).send("Link này không hỗ trợ kết nối Gemini (thiếu fbThreadId)."); return;
    }
  }

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

  // Service-user flow: key the resulting AI config by their account ID (shared
  // across all of their configured threads). Legacy one-off flow: key by the
  // raw FB thread ID from the connect link, as before.
  const ownerKey = serviceUser?.id ?? ut?.fbThreadId;
  const state = createOAuthState(isAdmin, ownerKey, userTokenId, serviceUser?.id);
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

    const { isAdmin, ownerKey, userTokenId, serviceUserId } = stateData;

    if (ownerKey) {
      // Per-user flow: save to UserAiConfig keyed by owner (service user ID, or
      // raw FB thread ID for the legacy one-off connect-link flow)
      await setUserAiConfig({
        ownerKey,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: Date.now() + tokens.expires_in * 1000,
        model: GEMINI_DEFAULT_MODEL,
        connectedAt: Date.now(),
      });
      if (userTokenId) await markUserTokenUsed(userTokenId, "gemini-oauth");
      if (serviceUserId) {
        res.redirect(`/u/${encodeURIComponent(serviceUserId)}?geminiOk=1`);
        return;
      }

      const availableModels = await fetchGeminiModels(tokens.access_token);
      const modelOptions = availableModels
        .map(m => `<option value="${m}" ${m === GEMINI_DEFAULT_MODEL ? "selected" : ""}>${m}</option>`)
        .join("");

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chon Model Gemini</title>
      <style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0d14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;margin:0}.card{background:#121624;border:1px solid #23293e;border-radius:14px;padding:28px;max-width:480px;width:100%;text-align:center}select,input{width:100%;padding:12px;border-radius:8px;border:1px solid #333a52;background:#080a10;color:#fff;font-size:15px;margin:10px 0 16px}button{background:#6366f1;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;width:100%}</style>
      </head><body><div class="card">
        <div style="font-size:3rem;margin-bottom:8px">&#x1F389;</div>
        <h2 style="color:#4ade80;margin:0 0 8px">Da ket noi Google thanh cong!</h2>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:20px">Chon model Gemini ma ban muon bot su dung khi tra loi Messenger:</p>
        <form method="POST" action="/connect/gemini/select-model">
          <input type="hidden" name="ownerKey" value="${ownerKey}" />
          <select name="model">${modelOptions}</select>
          <button type="submit">Xac nhan Model &amp; Bat dau dung</button>
        </form>
      </div></body></html>`);
      return;
    } else if (isAdmin) {
      // Admin flow: set global botState (legacy)
      botState.aiBaseUrl = GEMINI_BASE_URL;
      botState.aiApiKey = tokens.access_token;
      botState.aiModel = GEMINI_DEFAULT_MODEL;
      if (tokens.refresh_token) {
        (botState as any)._geminiRefreshToken = tokens.refresh_token;
        (botState as any)._geminiTokenExpiry = Date.now() + tokens.expires_in * 1000;
      }
      logger.info({ model: botState.aiModel }, "Gemini connected via OAuth (admin global)");
      res.redirect("/admin?geminiOk=1");
    } else {
      res.status(400).send("Khong xac dinh duoc nguoi dung.");
    }
  } catch (err: any) {
    logger.error({ err: err?.message }, "Gemini OAuth callback failed");
    res.redirect(`/admin?geminiErr=${encodeURIComponent(err?.message ?? "unknown")}`);
  }
});



app.post("/connect/gemini/select-model", async (req: Request, res: Response) => {
  const { ownerKey, model } = req.body as { ownerKey?: string; model?: string };
  if (ownerKey && model) {
    await updateUserAiModel(ownerKey, model.replace(/^models\//, "").trim());
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cai dat thanh cong</title>
  <style>body{font-family:sans-serif;background:#0b0d14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:12px;padding:20px;text-align:center}</style>
  </head><body>
    <div style="font-size:3.5rem">&#x2705;</div>
    <h2 style="color:#4ade80;margin:0">Cai dat Model thanh cong!</h2>
    <p style="color:#94a3b8">Bot Facebook Messenger se tra loi tin nhan bang model Gemini ban vua chon.</p>
    <p style="color:#64748b;font-size:13px">Ban co the dong tab nay va tiep tuc chat tren Messenger.</p>
  </body></html>`);
});

app.get("/connect/9router", (req: Request, res: Response) => {
  const q = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  res.redirect(302, "/connect/gemini" + q);
});

app.post("/connect/9router/authorize", (req: Request, res: Response) => {
  const q = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  res.redirect(302, "/connect/gemini" + q);
});

// ── Dashboard SPA static files ───────────────────────────────────────────────────────────
const dashboardDist = process.env.DASHBOARD_DIST;
if (dashboardDist && fs.existsSync(dashboardDist)) {
  // SPA itself is behind admin gate (the HTML cookie check happens client side;
  // actual API calls are blocked by requireAdmin above)
  app.use(express.static(dashboardDist, { index: false }));
  app.use((_req: Request, res: Response, _next: NextFunction) => {
    // SPA catch-all for dashboard routes, but NOT for root landing page
    if (_req.path === "/") { _next(); return; }
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}

export default app;