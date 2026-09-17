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
  GOOGLE_WEB_CLIENT_ID, GOOGLE_WEB_CLIENT_SECRET, HAS_WEB_OAUTH_CLIENT,
  GEMINI_LOOPBACK_REDIRECT_URI,
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
// Match Gemini CLI / Code Assist OAuth. These scopes work with cloudcode-pa and
// avoid requiring each deployment to own a Google OAuth consent screen.
const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

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


  // Service-user flow: key the resulting AI config by their account ID (shared
  // across all of their configured threads). Legacy one-off flow: key by the
  // raw FB thread ID from the connect link, as before.
  const ownerKey = serviceUser?.id ?? ut?.fbThreadId;
  const state = createOAuthState(isAdmin, ownerKey, userTokenId, serviceUser?.id);

  // Web OAuth client (deployment-owned): normal hosted redirect flow.
  if (HAS_WEB_OAUTH_CLIENT) {
    const redirectUri = `${req.protocol}://${req.get("host")}/connect/gemini/callback`;
    const params = new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GEMINI_SCOPES,
      access_type: "offline",
      prompt: "consent select_account",
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    return;
  }

  // Built-in installed-app client: Google only accepts a loopback redirect, so
  // send the user to Google and have them paste back the resulting URL/code.
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GEMINI_LOOPBACK_REDIRECT_URI,
    response_type: "code",
    scope: GEMINI_SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Google Gemini</title>
  <style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0d14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;margin:0}.card{background:#121624;border:1px solid #23293e;border-radius:14px;padding:28px;max-width:560px;width:100%}ol{text-align:left;color:#94a3b8;font-size:14px;line-height:1.7;padding-left:20px}code{background:#080a10;padding:2px 6px;border-radius:4px;color:#a5b4fc;font-size:13px;word-break:break-all}input{width:100%;padding:12px;border-radius:8px;border:1px solid #333a52;background:#080a10;color:#fff;font-size:14px;margin:10px 0 16px}button,.btn{display:block;text-align:center;background:#6366f1;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;width:100%;text-decoration:none;margin-bottom:16px}</style>
  </head><body><div class="card">
    <h2 style="margin:0 0 12px">Kết nối Google Gemini</h2>
    <a class="btn" href="${authUrl}" target="_blank" rel="noopener">Bước 1 — Mở trang đăng nhập Google</a>
    <ol>
      <li>Đăng nhập và bấm đồng ý (Allow).</li>
      <li>Trình duyệt sẽ chuyển tới <code>${GEMINI_LOOPBACK_REDIRECT_URI}/?code=...</code> và báo lỗi không truy cập được. Đây là bình thường.</li>
      <li>Copy toàn bộ URL trên thanh địa chỉ của trang lỗi đó.</li>
      <li>Dán vào ô bên dưới rồi bấm Hoàn tất.</li>
    </ol>
    <form method="POST" action="/connect/gemini/paste-code">
      <input type="hidden" name="state" value="${state}" />
      <input name="pasted" placeholder="Dán URL hoặc mã code vào đây" required autocomplete="off" />
      <button type="submit">Bước 2 — Hoàn tất kết nối</button>
    </form>
  </div></body></html>`);
});

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function exchangeGeminiCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  } as RequestInit & { signal: AbortSignal });

  if (!tokenRes.ok) throw new Error(`Token exchange HTTP ${tokenRes.status}: ${await tokenRes.text()}`);

  const tokens = await tokenRes.json() as GoogleTokens;
  if (!tokens.access_token) throw new Error("Khong co access_token trong response");
  return tokens;
}

// Google appends ?code=... to the loopback redirect. Users paste either that
// whole URL or just the bare code, so accept both shapes.
function extractAuthCode(pasted: string): string | undefined {
  const raw = pasted.trim();
  if (!raw) return undefined;
  const match = raw.match(/[?&]code=([^&\s]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  if (/^https?:\/\//i.test(raw)) return undefined;
  return raw;
}

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
    // This hosted callback only ever runs for a deployment-owned web client;
    // the built-in installed-app client goes through the loopback/paste flow.
    const tokens = await exchangeGeminiCode(
      code,
      HAS_WEB_OAUTH_CLIENT ? GOOGLE_WEB_CLIENT_ID : GOOGLE_CLIENT_ID,
      HAS_WEB_OAUTH_CLIENT ? GOOGLE_WEB_CLIENT_SECRET : GOOGLE_CLIENT_SECRET,
      redirectUri,
    );

    await finishGeminiConnect(res, tokens, stateData);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Gemini OAuth callback failed");
    res.redirect(`/admin?geminiErr=${encodeURIComponent(err?.message ?? "unknown")}`);
  }
});

async function finishGeminiConnect(
  res: Response,
  tokens: GoogleTokens,
  stateData: { isAdmin: boolean; ownerKey?: string; userTokenId?: string; serviceUserId?: string },
): Promise<void> {
  {
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
        providerLabel: "Gemini",
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
  }
}

// Loopback flow completion: the user pastes the redirect URL (or bare code)
// that Google produced for the built-in installed-app client.
app.post("/connect/gemini/paste-code", async (req: Request, res: Response) => {
  const { state, pasted } = req.body as { state?: string; pasted?: string };

  const stateData = consumeOAuthState(state ?? "");
  if (!stateData) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send("Phien ket noi het han. <a href='/connect/gemini'>Thu lai</a>");
    return;
  }

  const code = extractAuthCode(pasted ?? "");
  if (!code) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send("Khong tim thay ma code trong noi dung da dan. <a href='/connect/gemini'>Thu lai</a>");
    return;
  }

  try {
    const tokens = await exchangeGeminiCode(
      code,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GEMINI_LOOPBACK_REDIRECT_URI,
    );
    await finishGeminiConnect(res, tokens, stateData);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Gemini OAuth paste-code failed");
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`Doi ma that bai: ${err?.message ?? "unknown"}. <a href='/connect/gemini'>Thu lai</a>`);
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