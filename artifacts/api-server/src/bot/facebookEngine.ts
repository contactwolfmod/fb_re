import login, { type IFCAU_API, type IFCAU_Options } from "@xaviabot/fca-unofficial";
import { logger } from "../lib/logger";
import { bufferLog } from "../lib/logBuffer";
import { getClaudeReply } from "./claude";
import * as fs from "fs";
import * as path from "path";

// Persisted session cookies (fca-unofficial's AppState). On Railway: mount a
// volume at /data and set STATE_DIR=/data for persistence across restarts.
// Without a volume, state resets on each deploy.
//
// NOTE: this used to store a Playwright storageState() ({cookies, origins})
// blob under the same file name, back when this engine drove a full headless
// Chromium browser instead of fca-unofficial's HTTP/MQTT API. That format is
// incompatible with the plain cookie array this engine now reads/writes —
// loadSavedAppState() below detects the old shape and treats it as "no saved
// state" rather than crashing, so the one-time consequence of this migration
// is just needing to log back in once.
const STATE_BASE = process.env.STATE_DIR ?? path.join(process.cwd(), "dist");

// fca-unofficial frequently rejects/errors with plain objects (e.g.
// {error: "..."}) rather than Error instances — String(err) on those just
// prints "[object Object]", hiding the actual cause. Always log through this.
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

type MqttEmitter = ReturnType<IFCAU_API["listenMqtt"]>;

// selfListen/listenEvents off (default) → we only ever receive real "message"
// / "message_reply" events, not our own echoes or thread-event noise.
// logLevel/pauseLog silence the library's own npmlog output — our blog()
// calls are the source of truth for what shows up in `railway logs`.
const LOGIN_OPTIONS: Partial<IFCAU_Options> = {
  selfListen: false,
  listenEvents: false,
  autoMarkDelivery: false,
  autoMarkRead: false,
  logLevel: "silent",
  pauseLog: true,
};

/**
 * One logged-in Facebook Messenger session: login, listen for new messages
 * in real time (MQTT push, no polling), reply via AI. Each instance is
 * fully independent (its own session, dedupe state, persisted cookies file)
 * so the same class backs both the single shared admin bot and per-customer
 * tenant bots.
 *
 * Built on @xaviabot/fca-unofficial (HTTP + MQTT, no browser) instead of a
 * Playwright-driven headless Chromium — the previous browser-based
 * implementation reloaded Facebook's full JS-based Messenger UI on a 5s
 * poll loop, which was heavy enough to exhaust a 1GB container running just
 * one session (confirmed via `railway metrics` — memory pinned at the
 * service's actual limit) and crash-looped every ~20s as a result.
 */
export class FacebookBotEngine {
  private opts: EngineOptions;
  private statePath: string;
  private autostartFlagPath: string;

  private api: IFCAU_API | null = null;
  private mqttEmitter: MqttEmitter | null = null;
  private pending2FA: ((code: string) => Promise<IFCAU_API>) | null = null;
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

  /** Accept both fca-unofficial's native {key, ...} cookie shape and the
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
    if (this.repliedMessageIds.has(messageId)) return;
    this.repliedMessageIds.add(messageId);
    if (this.repliedMessageIds.size > 500) this.repliedMessageIds.delete(this.repliedMessageIds.values().next().value!);

    if (!this.opts.autoReplyEnabled()) return;
    if (!body.trim()) return;
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

  private sendFbMessage(threadID: string, text: string): Promise<void> {
    if (!this.api) return Promise.reject(new Error("Bot chưa đăng nhập."));
    const api = this.api;
    return new Promise<void>((resolve, reject) => {
      api.sendMessage(text, threadID, (err) => (err ? reject(err) : resolve()));
    });
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  private onLoggedIn(api: IFCAU_API) {
    this.api = api;
    this.pending2FA = null;
    this.saveAppState();

    try {
      fs.mkdirSync(STATE_BASE, { recursive: true });
      fs.writeFileSync(this.autostartFlagPath, new Date().toISOString());
    } catch {}

    this.opts.state.status = "running";
    this.opts.state.startedAt = new Date();
    this.opts.state.error = null;

    this.mqttEmitter = api.listenMqtt((err, message) => {
      if (err) {
        this.blog("error", { err: describeErr(err) }, "listenMqtt error — session likely invalidated");
        this.opts.state.status = "error";
        this.opts.state.error = "Mất kết nối phiên Messenger. Vui lòng khởi động lại bot.";
        return;
      }
      if (!message) return;
      if (message.type === "message" || message.type === "message_reply") {
        this.handleMessage(message.threadID, !!message.isGroup, message.body ?? "", message.senderID, message.messageID)
          .catch((e) => this.blog("error", { err: describeErr(e) }, "handleMessage threw"));
      }
    });

    this.blog("info", { uid: api.getCurrentUserID() }, "Session ready — listening for messages");
  }

  /** Check whether a saved session + autostart flag exist for auto-restart. */
  canAutoRestart(): boolean {
    return fs.existsSync(this.autostartFlagPath) && fs.existsSync(this.statePath);
  }

  // ── Submit OTP code when Facebook requires 2-step verification ───────────────
  async submit2FACode(code: string): Promise<void> {
    if (!this.pending2FA || this.opts.state.status !== "waiting_2fa") {
      throw new Error("Không có phiên 2FA đang chờ. Vui lòng đăng nhập lại.");
    }
    this.blog("info", {}, "Submitting 2FA OTP code");
    try {
      const api = await this.pending2FA(code.trim());
      this.onLoggedIn(api);
    } catch (err: any) {
      if (err?.error === "login-approval" && typeof err.continue === "function") {
        // Wrong code — stay in waiting_2fa and allow retry with the new continuation.
        this.pending2FA = err.continue;
        const message = err?.errordesc ?? "Mã xác minh không đúng. Vui lòng thử lại.";
        this.opts.state.error = message;
        throw new Error(message);
      }
      this.opts.state.status = "error";
      const message = err?.message ?? "Xác minh 2FA thất bại.";
      this.opts.state.error = message;
      throw err instanceof Error ? err : new Error(message);
    }
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
    this.pending2FA = null;

    const loginCreds =
      credentials.type === "appstate"
        ? { appState: this.normalizeAppState(credentials.appState) }
        : { email: credentials.email, password: credentials.password };

    this.blog("info", { type: credentials.type }, "Logging in to Facebook");

    try {
      // fca-unofficial's own .d.ts mistypes `appState` as `{appState: Cookie[]}`
      // instead of `Cookie[]` (confirmed against index.js, which reads
      // loginData.appState as a plain array) — cast around that upstream bug.
      const api = await login(loginCreds as any, LOGIN_OPTIONS);
      this.onLoggedIn(api);
    } catch (err: any) {
      if (err?.error === "login-approval" && typeof err.continue === "function") {
        this.pending2FA = err.continue;
        this.opts.state.status = "waiting_2fa";
        this.opts.state.error = "Tài khoản yêu cầu xác minh 2 bước. Vui lòng nhập mã OTP để tiếp tục đăng nhập.";
        throw new TwoFactorRequired();
      }
      const message = err?.message ?? (typeof err === "string" ? err : err?.error ?? "Đăng nhập thất bại.");
      this.opts.state.status = "error";
      this.opts.state.error = message;
      this.blog("error", { err: message }, "Login failed");
      throw err instanceof Error ? err : new Error(message);
    }
  }

  stop(): void {
    try { this.mqttEmitter?.stopListening(); } catch {}
    try { this.api?.logout().catch(() => {}); } catch {}
    this.api = null;
    this.mqttEmitter = null;
    this.pending2FA = null;
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
   * Resolve a Facebook profile link to its numeric ID (and display name)
   * using this engine's own logged-in session — a real Graph search
   * (api.getUserID), not DOM scraping. Only works while the bot is running.
   */
  async resolveProfileId(profileUrl: string): Promise<{ id?: string; name?: string; error?: string }> {
    if (!this.api) {
      return { error: "Bot chưa chạy nên không thể tra ID qua phiên đăng nhập. Vui lòng khởi động bot hoặc dán ID (dạng số) trực tiếp." };
    }

    const idMatch = profileUrl.match(/profile\.php\?id=(\d{5,20})/);
    if (idMatch) return { id: idMatch[1] };

    const vanity = profileUrl.match(/facebook\.com\/([a-zA-Z0-9.\-_]+)/i)?.[1];
    if (!vanity || vanity.toLowerCase() === "profile.php") {
      return { error: "Không đọc được tên người dùng từ link. Vui lòng dán ID Facebook (dạng số) trực tiếp." };
    }

    try {
      const results = await this.api.getUserID(vanity);
      const top = results?.[0];
      if (!top?.userID) {
        return { error: "Không tìm thấy người dùng này qua phiên đăng nhập. Vui lòng dán ID Facebook (dạng số) trực tiếp." };
      }
      return { id: top.userID, name: top.name };
    } catch (err: any) {
      return { error: err?.message ?? "Không tra được ID qua phiên đăng nhập." };
    }
  }
}
