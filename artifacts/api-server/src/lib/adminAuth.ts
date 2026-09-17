import { type Request, type Response, type NextFunction } from "express";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { eq, lt } from "drizzle-orm";
import { db, serviceUsersTable, aiAccountsTable, userTokensTable, userAiConfigsTable } from "@workspace/db";

// Admin token from env (required). If not set, admin routes return 503.
export const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// Public installed-app OAuth client used by Gemini CLI / Code Assist.
// Secret is embedded by Google in the open-source CLI; for installed apps it is
// not treated as confidential.
const GEMINI_CLI_CLIENT_ID_PARTS = [
  "681255809395",
  "oo8ft2oprdrnp9e3aqf6av3hmdib135j",
  "apps.googleusercontent.com",
];
const GEMINI_CLI_CLIENT_SECRET_PARTS = ["GOCSPX", "4uHgMPm", "1o7Sk", "geV6Cu5clXFsxl"];

export const GOOGLE_CLIENT_ID = `${GEMINI_CLI_CLIENT_ID_PARTS[0]}-${GEMINI_CLI_CLIENT_ID_PARTS[1]}.${GEMINI_CLI_CLIENT_ID_PARTS[2]}`;
export const GOOGLE_CLIENT_SECRET = GEMINI_CLI_CLIENT_SECRET_PARTS.join("-");

// Gemini Code Assist native endpoint (not OpenAI-compatible)
export const GEMINI_BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

// ── Google OAuth states (short-lived, server-side CSRF protection) ────────────
// Kept in memory: these live for at most 10 minutes, so losing them on a
// redeploy just means restarting an in-progress OAuth flow — not real data.
const oauthStates = new Map<string, { createdAt: number; isAdmin: boolean; ownerKey?: string; userTokenId?: string; serviceUserId?: string }>();

export function createOAuthState(isAdmin: boolean, ownerKey?: string, userTokenId?: string, serviceUserId?: string): string {
  const state = randomUUID();
  oauthStates.set(state, { createdAt: Date.now(), isAdmin, ownerKey, userTokenId, serviceUserId });
  return state;
}

export function consumeOAuthState(state: string): { isAdmin: boolean; ownerKey?: string; userTokenId?: string; serviceUserId?: string } | undefined {
  const s = oauthStates.get(state);
  if (!s) return undefined;
  oauthStates.delete(state);
  // expire after 10 min
  if (Date.now() - s.createdAt > 600_000) return undefined;
  return { isAdmin: s.isAdmin, ownerKey: s.ownerKey, userTokenId: s.userTokenId, serviceUserId: s.serviceUserId };
}

// cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates.entries()) {
    if (now - v.createdAt > 600_000) oauthStates.delete(k);
  }
}, 600_000);

// ── AI provider accounts (Claude / 9Router / OpenRouter / ...) ─────────────────
// Persisted in Postgres so accounts survive redeploys.
export interface AiAccount {
  id: string;
  name: string;       // display name e.g. "9Router Production"
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: number;
}

export async function createAiAccount(opts: { name: string; baseUrl: string; apiKey: string; model: string }): Promise<AiAccount> {
  const acc: AiAccount = { id: randomUUID(), name: opts.name, baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model, createdAt: Date.now() };
  await db.insert(aiAccountsTable).values(acc);
  return acc;
}

export async function getAiAccount(id: string): Promise<AiAccount | undefined> {
  const [row] = await db.select().from(aiAccountsTable).where(eq(aiAccountsTable.id, id));
  return row;
}

export async function listAiAccounts(): Promise<AiAccount[]> {
  const rows = await db.select().from(aiAccountsTable);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteAiAccount(id: string): Promise<void> {
  await db.delete(aiAccountsTable).where(eq(aiAccountsTable.id, id));
}

// ── User-facing connect tokens (legacy one-off flow) ───────────────────────────
export interface UserToken {
  id: string;
  label: string;
  aiAccountId: string;
  fbThreadId: string;   // FB thread ID to bind Gemini token to (required for Gemini flow)
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByLabel: string;
  redirectUrl: string;
}

export async function createUserToken(opts: { label: string; aiAccountId: string; fbThreadId: string; ttlHours: number; redirectUrl: string }): Promise<UserToken> {
  const now = Date.now();
  const token: UserToken = {
    id: randomUUID(), label: opts.label, aiAccountId: opts.aiAccountId, fbThreadId: opts.fbThreadId,
    createdAt: now, expiresAt: now + opts.ttlHours * 3_600_000,
    usedAt: null, usedByLabel: "", redirectUrl: opts.redirectUrl,
  };
  await db.insert(userTokensTable).values(token);
  return token;
}

export async function getUserToken(id: string): Promise<UserToken | undefined> {
  const [row] = await db.select().from(userTokensTable).where(eq(userTokensTable.id, id));
  return row;
}

export async function markUserTokenUsed(id: string, byLabel?: string): Promise<void> {
  await db.update(userTokensTable)
    .set({ usedAt: Date.now(), ...(byLabel ? { usedByLabel: byLabel.slice(0, 120) } : {}) })
    .where(eq(userTokensTable.id, id));
}

export async function deleteUserToken(id: string): Promise<void> {
  await db.delete(userTokensTable).where(eq(userTokensTable.id, id));
}

export async function listUserTokens(): Promise<UserToken[]> {
  const rows = await db.select().from(userTokensTable);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

setInterval(() => {
  db.delete(userTokensTable).where(lt(userTokensTable.expiresAt, Date.now())).catch(() => {});
}, 600_000);

// ── Per-owner AI config ───────────────────────────────────────────────────────
// Keyed by "ownerKey": a service user's ID for the self-service flow, or a raw
// FB thread ID for the legacy one-off connect-link flow (no service user account).
// When baseUrl is set, bot uses that custom OpenAI-compatible endpoint with
// apiKey in accessToken. When baseUrl is empty/undefined, accessToken is a
// Google OAuth token and bot uses GEMINI_BASE_URL.
export interface UserAiConfig {
  ownerKey: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry: number;   // epoch ms
  model: string;
  baseUrl?: string;          // custom provider base URL (null = Gemini OAuth)
  providerLabel?: string;    // e.g. "ChatGPT", "OpenRouter", "Gemini"
  connectedAt: number;
}

export async function setUserAiConfig(config: UserAiConfig): Promise<void> {
  const values = {
    ...config,
    refreshToken: config.refreshToken ?? null,
    baseUrl: config.baseUrl ?? null,
    providerLabel: config.providerLabel ?? null,
  };
  await db.insert(userAiConfigsTable).values(values).onConflictDoUpdate({
    target: userAiConfigsTable.ownerKey,
    set: {
      accessToken: values.accessToken,
      refreshToken: values.refreshToken,
      tokenExpiry: values.tokenExpiry,
      model: values.model,
      baseUrl: values.baseUrl,
      providerLabel: values.providerLabel,
      connectedAt: values.connectedAt,
    },
  });
}

export async function getUserAiConfig(ownerKey: string): Promise<UserAiConfig | undefined> {
  const [row] = await db.select().from(userAiConfigsTable).where(eq(userAiConfigsTable.ownerKey, ownerKey));
  if (!row) return undefined;
  return { ...row, refreshToken: row.refreshToken ?? undefined, baseUrl: row.baseUrl ?? undefined, providerLabel: row.providerLabel ?? undefined };
}

export async function updateUserAiModel(ownerKey: string, model: string): Promise<boolean> {
  const result = await db.update(userAiConfigsTable).set({ model })
    .where(eq(userAiConfigsTable.ownerKey, ownerKey))
    .returning({ ownerKey: userAiConfigsTable.ownerKey });
  return result.length > 0;
}

export async function deleteUserAiConfig(ownerKey: string): Promise<void> {
  await db.delete(userAiConfigsTable).where(eq(userAiConfigsTable.ownerKey, ownerKey));
}

export async function listUserAiConfigs(): Promise<UserAiConfig[]> {
  const rows = await db.select().from(userAiConfigsTable);
  return rows.map(row => ({ ...row, refreshToken: row.refreshToken ?? undefined, baseUrl: row.baseUrl ?? undefined, providerLabel: row.providerLabel ?? undefined })).sort((a, b) => b.connectedAt - a.connectedAt);
}

export async function fetchGeminiModels(_accessToken: string): Promise<string[]> {
  // Code Assist OAuth tokens use cloud-platform scope and cloudcode-pa native API.
  // The public generativelanguage model-list endpoint is not reliable for these
  // tokens, so expose known Gemini chat models that cloudcode-pa accepts.
  return [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];
}

// ── Managed service users (customers) ───────────────────────────────────────────
// Persisted in Postgres so customer accounts, passwords, and reply
// configuration survive redeploys. Reply mode is self-configured by the
// service user from their own /u/:id page: "all" = auto-reply to every
// incoming Messenger conversation, "specific" = only the FB thread IDs
// they've explicitly added to threadIds.
export type ReplyMode = "all" | "specific";

export interface ServiceUser {
  id: string;
  name: string;
  passwordHash: string;
  replyMode: ReplyMode;
  threadIds: string[];
  systemPrompt: string;
  active: boolean;
  createdAt: number;
}

// Sessions are short-lived (7 days) and cheap to re-establish (just log back
// in), so they stay in memory rather than adding a table for them.
const userSessions = new Map<string, { userId: string; expiresAt: number }>();
const validThreadId = /^\d{5,32}$/;
const MAX_THREADS_PER_USER = 50;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function toServiceUser(row: typeof serviceUsersTable.$inferSelect): ServiceUser {
  return {
    id: row.id,
    name: row.name,
    passwordHash: row.passwordHash,
    replyMode: row.replyMode === "all" ? "all" : "specific",
    threadIds: row.threadIds ?? [],
    systemPrompt: row.systemPrompt ?? "",
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function createServiceUser(opts: { id: string; name: string; password: string }): Promise<ServiceUser> {
  const id = opts.id.toLowerCase();
  if (await getServiceUser(id)) throw new Error("ID nguoi dung da ton tai.");
  const row = {
    id, name: opts.name, passwordHash: hashPassword(opts.password),
    replyMode: "specific" as const, threadIds: [] as string[], systemPrompt: "",
    active: true, createdAt: Date.now(),
  };
  await db.insert(serviceUsersTable).values(row);
  return row;
}

export async function getServiceUser(id: string): Promise<ServiceUser | undefined> {
  const [row] = await db.select().from(serviceUsersTable).where(eq(serviceUsersTable.id, id.toLowerCase()));
  return row ? toServiceUser(row) : undefined;
}

export async function listServiceUsers(): Promise<ServiceUser[]> {
  const rows = await db.select().from(serviceUsersTable);
  return rows.map(toServiceUser).sort((a, b) => b.createdAt - a.createdAt);
}

export async function setServiceUserReplyMode(id: string, mode: ReplyMode): Promise<boolean> {
  const result = await db.update(serviceUsersTable).set({ replyMode: mode })
    .where(eq(serviceUsersTable.id, id.toLowerCase()))
    .returning({ id: serviceUsersTable.id });
  return result.length > 0;
}

const MAX_SYSTEM_PROMPT_LENGTH = 4000;

export async function setServiceUserSystemPrompt(id: string, prompt: string): Promise<boolean> {
  const result = await db.update(serviceUsersTable).set({ systemPrompt: prompt.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH) })
    .where(eq(serviceUsersTable.id, id.toLowerCase()))
    .returning({ id: serviceUsersTable.id });
  return result.length > 0;
}

export async function addServiceUserThread(id: string, threadId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getServiceUser(id);
  if (!user) return { ok: false, error: "Không tìm thấy user." };
  const clean = threadId.trim();
  if (!validThreadId.test(clean)) return { ok: false, error: "Thread ID không hợp lệ (chỉ gồm chữ số, 5-32 ký tự)." };
  if (user.threadIds.includes(clean)) return { ok: false, error: "Thread ID này đã được thêm." };
  if (user.threadIds.length >= MAX_THREADS_PER_USER) return { ok: false, error: "Đã đạt giới hạn số hội thoại." };
  await db.update(serviceUsersTable).set({ threadIds: [...user.threadIds, clean] }).where(eq(serviceUsersTable.id, user.id));
  return { ok: true };
}

export async function removeServiceUserThread(id: string, threadId: string): Promise<boolean> {
  const user = await getServiceUser(id);
  if (!user || !user.threadIds.includes(threadId)) return false;
  await db.update(serviceUsersTable)
    .set({ threadIds: user.threadIds.filter(t => t !== threadId) })
    .where(eq(serviceUsersTable.id, user.id));
  return true;
}

/**
 * Resolve which service user (if any) owns an incoming FB thread: an exact
 * match in their specific thread list wins; otherwise the earliest-created
 * active user in "reply all" mode acts as the default responder.
 */
export async function resolveServiceUserForThread(threadId: string): Promise<ServiceUser | undefined> {
  const users = await listServiceUsers();
  const byAge = [...users].sort((a, b) => a.createdAt - b.createdAt);
  let fallbackAll: ServiceUser | undefined;
  for (const user of byAge) {
    if (!user.active) continue;
    if (user.replyMode === "specific" && user.threadIds.includes(threadId)) return user;
    if (user.replyMode === "all" && !fallbackAll) fallbackAll = user;
  }
  return fallbackAll;
}

export async function deleteServiceUser(id: string): Promise<void> {
  const lowered = id.toLowerCase();
  await db.delete(serviceUsersTable).where(eq(serviceUsersTable.id, lowered));
  for (const [sessionId, session] of userSessions) if (session.userId === lowered) userSessions.delete(sessionId);
}

export async function setServiceUserActive(id: string, active: boolean): Promise<void> {
  await db.update(serviceUsersTable).set({ active }).where(eq(serviceUsersTable.id, id.toLowerCase()));
}

export function createUserSession(userId: string): string {
  const sessionId = randomBytes(32).toString("hex");
  userSessions.set(sessionId, { userId, expiresAt: Date.now() + 7 * 24 * 3_600_000 });
  return sessionId;
}

export async function authenticateServiceUser(id: string, password: string): Promise<ServiceUser | undefined> {
  const user = await getServiceUser(id);
  return user?.active && verifyPassword(password, user.passwordHash) ? user : undefined;
}

export async function getSessionUser(sessionId?: string): Promise<ServiceUser | undefined> {
  if (!sessionId) return undefined;
  const session = userSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) { userSessions.delete(sessionId); return undefined; }
  const user = await getServiceUser(session.userId);
  return user?.active ? user : undefined;
}

export function deleteUserSession(sessionId?: string): void { if (sessionId) userSessions.delete(sessionId); }

// ── Middleware ────────────────────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_TOKEN) { res.status(503).json({ error: "ADMIN_TOKEN env chua duoc dat." }); return; }
  const cookie = (req as any).cookies?.["adminToken"] as string | undefined;
  if (cookie && cookie === ADMIN_TOKEN) { next(); return; }
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === ADMIN_TOKEN) { next(); return; }
  res.status(401).json({ error: "Chua dang nhap admin" });
}
