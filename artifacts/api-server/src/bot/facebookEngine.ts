import { login } from "ws3-fca";
import { logger } from "../lib/logger";
import { bufferLog } from "../lib/logBuffer";
import { getClaudeReply } from "./claude";
import * as fs from "fs";
import * as path from "path";

// Persisted session cookies (AppState array). On Railway: mount a volume at
// /data and set STATE_DIR=/data for persistence across restarts/deploys.
// Without a volume, state resets on each deploy.
//
// NOTE: this used to store a Playwright storageState() ({cookies, origins})
// blob, then briefly an @xaviabot/fca-unofficial cookie array, under the
// same file name. Both older formats are incompatible with the plain
// {key,value} cookie array this engine reads/writes now —
// loadSavedAppState() below detects an unparseable/old-shaped file and
// treats it as "no saved state" rather than crashing, so the one-time
// consequence of a format change is just needing to log back in once.
const STATE_BASE = process.env.STATE_DIR ?? path.join(process.cwd(), "dist");

// ws3-fca (and every other fca-unofficial-lineage library) reports errors as
// plain objects (e.g. {error: "..."}) as often as real Error instances —
// String(err) on those just prints "[object Object]", hiding the actual
// cause. Always log through this.
function describeErr(err: any): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export type LoginCredentials =
  | { type: "credentials"; email: string; password: string }
  | { type: "appstate"; appState: any[] };

// ── Special error thrown when Facebook requires 2FA ─────────────────────────
// NOTE: ws3-fca's email/password login has no interactive 2FA-continuation
// API (unlike some other fca forks) — a 2FA-protected account just fails
// with a generic "Wrong password / email" error. This class and
// submit2FACode() are kept so routes/user.ts and routes/bot.ts (which
// import and handle them) don't need changes, but in practice this path is
// no longer reachable: 2FA-protected accounts must connect via
// appState/cookie login instead (2FA is a non-issue there, since the
// cookies already come from a fully-authenticated browser session).
export class TwoFactorRequired extends Error {
  constructor() {
    super("2FA_REQUIRED");
    this.name = "TwoFactorRequired";
  }
}

export type EngineStatus = "stopped" | "connecting" | "running" | "error" | "waiting_2fa";

export interface EngineState {
  status: EngineStatus;
  error: string | null;
  startedAt: Date | null;
  messagesHandled: number;
}

export interface ReplyResolution {
  ownerKey: string;
  systemPrompt: string;
}

export interface EngineOptions {
  /** Used for log tagging and per-instance state file naming. "admin" maps
   *  to the original unsuffixed file names for backward compatibility. */
  id: string;
  /** Caller-owned status object, mutated in place. */
  state: EngineState;
  autoReplyEnabled: () => boolean;
  isThreadIgnored: (threadId: string) => boolean;
  /** Resolve which AI config/prompt should answer a given incoming thread,
   *  or null if this engine shouldn't reply to it at all. */
  resolveReply: (threadId: string) => Promise<ReplyResolution | null>;
  /** Called when resolveReply returns null and the engine would otherwise
   *  skip silently — return a message to send instead (e.g. a Gemini
   *  connect link), or null/undefined to just skip. */
  onUnresolvedThread?: (threadId: string) => Promise<string | null>;
}

// selfListen/listenEvents off → we only ever receive real "message" /
// "message_reply" events, not our own echoes or thread-event noise.
//
// logging left ON (ws3-fca's own console.log/error output) — turning it off
// hid the real cause of a silent "AI never replies" report: ws3-fca's mqtt
// client swallows connection failures internally and retries
// (autoReconnect) without ever surfacing an error through our callback, so
// its own console output is the only place a broken MQTT connection shows
// up at all.
//
// online:true — this maps directly to `chat_on` in the raw MQTT CONNECT
// payload (see ws3-fca's listenMqtt.js: `chatOn = ctx.globalOptions.online`).
// With it false, the connection told Facebook this session wasn't actively
// "online" — plausibly why a fully healthy, correctly-subscribed connection
// (verified via packet-level logging: subacks, pings, presence deltas all
// flowing) never received a single new-message delta for a real, delivered
// message. Worth the minor tradeoff of showing as "active" to contacts.
const LOGIN_OPTIONS: Record<string, any> = {
  selfListen: false,
  listenEvents: false,
  updatePresence: false,
  autoMarkDelivery: false,
  autoMarkRead: false,
  online: true,
  logging: true,
};

/**
 * One logged-in Facebook Messenger session: login, listen for new messages
 * in real time (MQTT push, no polling), reply via AI. Each instance is
 * fully independent (its own session, dedupe state, persisted cookies file)
 * so the same class backs both the single shared admin bot and per-customer
 * tenant bots.
 *
 * Built on ws3-fca (HTTP + MQTT, no browser) — a Playwright-driven headless
 * Chromium implementation was replaced here because it reloaded Facebook's
 * full JS-based Messenger UI on a 5s poll loop, heavy enough to exhaust a
 * 1GB container running just one session (confirmed via `railway metrics` —
 * memory pinned at the service's actual limit) and crash-loop every ~20s.
 * An earlier attempt at this same migration used @xaviabot/fca-unofficial,
 * whose initial message-sync call (a graphqlbatch request Facebook's
 * anti-bot layer rejects from datacenter IPs) failed outright. ws3-fca
 * avoids that specific call in the common case by reading the initial sync
 * sequence ID straight out of the login page's HTML instead.
 */
export class FacebookBotEngine {
  private opts: EngineOptions;
  private statePath: string;
  private autostartFlagPath: string;

  private api: any = null;
  private mqttEmitter: any = null;
  // Cheap safety net — MQTT shouldn't double-deliver, but dedupe is nearly free.
  private repliedMessageIds = new Set<string>();

  constructor(opts: EngineOptions) {
    this.opts = opts;
    const suffix = opts.id === "admin" ? "" : `-${opts.id}`;
    this.statePath = path.join(STATE_BASE, `browser-state${suffix}.json`);
    this.autostartFlagPath = path.join(STATE_BASE, `autostart${suffix}.flag`);
  }

  // Helper: log to both pino and the in-memory buffer visible in the dashboard
  private blog(level: "info" | "warn" | "error", data: Record<string, any>, msg: string) {
    logger[level]({ ...data, engine: this.opts.id }, msg);
    bufferLog(level, msg, { ...data, engine: this.opts.id });
  }

  private loadSavedAppState(): any[] | null {
    try {
      if (!fs.existsSync(this.statePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.blog("info", { path: this.statePath }, "Loaded saved session state");
        return parsed;
      }
      this.blog("warn", { path: this.statePath }, "Saved state file is in an old/incompatible format — ignoring, fresh login required");
      return null;
    } catch (e) {
      this.blog("warn", { err: describeErr(e) }, "Could not load saved session state — will need a fresh login");
      return null;
    }
  }

  private saveAppState(): void {
    if (!this.api) return;
    try {
      const state = this.api.getAppState();
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(state));
      this.blog("info", {}, "Session state saved");
    } catch (e) {
      this.blog("warn", { err: describeErr(e) }, "Could not save session state");
    }
  }

  /** Accept both ws3-fca's native {key, ...} cookie shape and the
   *  {name, expirationDate} shape standard browser cookie-export extensions
   *  (Cookie-Editor, EditThisCookie, ...) produce — customers connecting
   *  their own account are far more likely to paste one of those. */
  private normalizeAppState(appState: any[]): any[] {
    return appState.map((c: any) => ({
      key: c.key ?? c.name,
      value: c.value,
      domain: c.domain ?? ".facebook.com",
      path: c.path ?? "/",
      hostOnly: c.hostOnly ?? false,
      creation: c.creation ?? new Date().toISOString(),
      lastAccessed: c.lastAccessed ?? new Date().toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Message handler → AI reply
  // ---------------------------------------------------------------------------

  private async handleMessage(threadId: string, isGroup: boolean, body: string, senderID: string, messageId: string) {
    if (this.repliedMessageIds.has(messageId)) {
      this.blog("info", { threadId, messageId }, "Duplicate message event — already handled");
      return;
    }
    this.repliedMessageIds.add(messageId);
    if (this.repliedMessageIds.size > 500) this.repliedMessageIds.delete(this.repliedMessageIds.values().next().value!);

    if (!this.opts.autoReplyEnabled()) {
      this.blog("info", { threadId }, "Auto-reply is disabled — skipping");
      return;
    }
    if (!body.trim()) {
      this.blog("info", { threadId }, "Empty message body (likely an attachment-only message) — skipping");
      return;
    }
    if (isGroup) {
      this.blog("info", { threadId }, "Skipping group/community thread (DM-only mode)");
      return;
    }
    if (this.opts.isThreadIgnored(threadId)) {
      this.blog("info", { threadId }, "Thread ignored");
      return;
    }

    const resolved = await this.opts.resolveReply(threadId);
    if (!resolved) {
      if (this.api && this.opts.onUnresolvedThread) {
        const fallbackMsg = await this.opts.onUnresolvedThread(threadId);
        if (fallbackMsg) {
          this.blog("info", { threadId }, "No AI config — sending fallback message");
          await this.sendFbMessage(threadId, fallbackMsg);
        } else {
          this.blog("warn", { threadId }, "No AI config and no fallback message — skipping");
        }
      } else {
        this.blog("info", { threadId }, "resolveReply returned null (owner inactive, or thread not in allowed list) — skipping");
      }
      return;
    }

    this.blog("info", { threadId, senderID, body: body.substring(0, 80) }, "Message → AI");
    if (!this.api) {
      this.blog("warn", { threadId }, "Not logged in — cannot reply");
      return;
    }

    try {
      const reply = await getClaudeReply(threadId, body, resolved.systemPrompt, resolved.ownerKey);
      if (!reply || !reply.trim()) {
        this.blog("error", { threadId }, "AI returned empty reply — skipping send");
        return;
      }
      this.blog("info", { threadId, replyPreview: reply.substring(0, 80) }, "AI reply ready");
      await this.sendFbMessage(threadId, reply);
      this.opts.state.messagesHandled++;
      this.blog("info", { threadId }, "Reply sent ✓");
    } catch (err) {
      this.blog("error", { err: describeErr(err), threadId }, "Reply failed — sending fallback");
      try {
        await this.sendFbMessage(threadId, "Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.");
        this.blog("info", { threadId }, "Fallback message sent");
      } catch (fbErr) {
        this.blog("error", { err: describeErr(fbErr), threadId }, "Fallback send also failed");
      }
    }
  }

  private async sendFbMessage(threadID: string, text: string): Promise<void> {
    if (!this.api) throw new Error("Bot chưa đăng nhập.");
    await this.api.sendMessage(text, threadID);
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  private onLoggedIn(api: any) {
    this.api = api;
    this.saveAppState();

    try {
      fs.mkdirSync(STATE_BASE, { recursive: true });
      fs.writeFileSync(this.autostartFlagPath, new Date().toISOString());
    } catch {}

    this.opts.state.status = "running";
    this.opts.state.startedAt = new Date();
    this.opts.state.error = null;

    this.mqttEmitter = api.listenMqtt((err: any, message: any) => {
      if (err) {
        this.blog("error", { err: describeErr(err) }, "listenMqtt error — session likely invalidated");
        this.opts.state.status = "error";
        this.opts.state.error = "Mất kết nối phiên Messenger. Vui lòng khởi động lại bot.";
        return;
      }
      if (!message) return;
      this.blog("info", { type: message.type, threadId: message.threadID }, "MQTT event received");
      if (message.type === "message" || message.type === "message_reply") {
        // ws3-fca's own `isGroup` flag is unreliable: its realtime formatter
        // sets it from Facebook's threadKey.threadFbId, which is also set
        // for a 1-on-1 "message request" from someone not yet a contact —
        // not just for real multi-person groups. participantIDs.length is
        // the accurate signal (a real group has more than 2 people); fall
        // back to the library's flag only if that field is missing.
        const participantCount = Array.isArray(message.participantIDs) ? message.participantIDs.length : null;
        const isGroup = participantCount !== null ? participantCount > 2 : !!message.isGroup;
        this.handleMessage(message.threadID, isGroup, message.body ?? "", message.senderID, message.messageID)
          .catch((e) => this.blog("error", { err: describeErr(e) }, "handleMessage threw"));
      }
    });

    this.blog("info", { uid: api.getCurrentUserID() }, "Session ready — listening for messages");
  }

  /** Check whether a saved session + autostart flag exist for auto-restart. */
  canAutoRestart(): boolean {
    return fs.existsSync(this.autostartFlagPath) && fs.existsSync(this.statePath);
  }

  /** Whether a saved cookie session exists on disk, regardless of the
   *  autostart flag — used to let the "connect" form skip re-pasting
   *  cookies when a previous login already saved a reusable session. */
  hasSavedSession(): boolean {
    return fs.existsSync(this.statePath);
  }

  // No interactive 2FA continuation exists in ws3-fca — see the class-level
  // note on TwoFactorRequired. Kept only so callers don't need changes.
  async submit2FACode(_code: string): Promise<void> {
    throw new Error("Không có phiên 2FA đang chờ. Vui lòng đăng nhập lại bằng cookie (appState) thay vì email/mật khẩu.");
  }

  async start(credentials: LoginCredentials): Promise<void> {
    if (this.opts.state.status === "running" || this.opts.state.status === "connecting") {
      throw new Error("Bot đang chạy hoặc đang kết nối");
    }

    this.opts.state.status = "connecting";
    this.opts.state.error = null;
    this.opts.state.startedAt = null;
    this.opts.state.messagesHandled = 0;
    this.repliedMessageIds.clear();

    const loginCreds =
      credentials.type === "appstate"
        ? { appState: this.normalizeAppState(credentials.appState.length > 0 ? credentials.appState : this.loadSavedAppState() ?? []) }
        : { email: credentials.email, password: credentials.password };

    this.blog("info", { type: credentials.type }, "Logging in to Facebook");

    try {
      const api = await new Promise<any>((resolve, reject) => {
        login(loginCreds, LOGIN_OPTIONS, (err: any, resolvedApi: any) => {
          if (err) reject(err);
          else resolve(resolvedApi);
        });
      });
      this.onLoggedIn(api);
    } catch (err: any) {
      const message = err?.message ?? (typeof err === "string" ? err : err?.error ?? "Đăng nhập thất bại.");
      this.opts.state.status = "error";
      this.opts.state.error = message;
      this.blog("error", { err: message }, "Login failed");
      throw err instanceof Error ? err : new Error(message);
    }
  }

  stop(): void {
    try { this.mqttEmitter?.stop(); } catch {}
    try { this.api?.logout?.().catch(() => {}); } catch {}
    this.api = null;
    this.mqttEmitter = null;
    this.opts.state.status = "stopped";
    this.opts.state.error = null;
    // Remove autostart flag so server won't restart bot on next reboot
    try { fs.unlinkSync(this.autostartFlagPath); } catch {}
    this.blog("info", {}, "Bot stopped");
  }

  getFacebookApi() {
    return this.api ? { active: true } : null;
  }

  /**
   * Resolve a Facebook profile link to its numeric ID using this engine's
   * own logged-in session. Only numeric links (profile.php?id=... or a bare
   * numeric ID) can be resolved this way — ws3-fca has no vanity-name
   * lookup API, so a vanity URL (facebook.com/some.name) falls straight
   * back to the caller's next resolution tier (HTTP-based Open Graph
   * scraping in lib/facebookId.ts, then manual entry).
   */
  async resolveProfileId(profileUrl: string): Promise<{ id?: string; name?: string; error?: string }> {
    const idMatch = profileUrl.match(/profile\.php\?id=(\d{5,20})/);
    if (idMatch) return { id: idMatch[1] };

    const bareIdMatch = profileUrl.trim().match(/^(\d{5,20})$/);
    if (bareIdMatch) return { id: bareIdMatch[1] };

    return {
      error:
        "Không đọc được ID số từ link này qua phiên đăng nhập bot. Vui lòng dán ID Facebook (dạng số) hoặc link dạng profile.php?id=...",
    };
  }
}
