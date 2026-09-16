import { type Request, type Response, type NextFunction } from "express";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Admin token from env (required). If not set, admin routes return 503.
export const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// Google OAuth env
export const GOOGLE_CLIENT_ID = process.env["GOOGLE_CLIENT_ID"] ?? "";
export const GOOGLE_CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

// Gemini OpenAI-compatible base URL
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

// ── Google OAuth states (short-lived, server-side CSRF protection) ────────────
const oauthStates = new Map<string, { createdAt: number; isAdmin: boolean; threadId?: string; userTokenId?: string; serviceUserId?: string }>();

export function createOAuthState(isAdmin: boolean, threadId?: string, userTokenId?: string, serviceUserId?: string): string {
  const state = randomUUID();
  oauthStates.set(state, { createdAt: Date.now(), isAdmin, threadId, userTokenId, serviceUserId });
  return state;
}

export function consumeOAuthState(state: string): { isAdmin: boolean; threadId?: string; userTokenId?: string; serviceUserId?: string } | undefined {
  const s = oauthStates.get(state);
  if (!s) return undefined;
  oauthStates.delete(state);
  // expire after 10 min
  if (Date.now() - s.createdAt > 600_000) return undefined;
  return { isAdmin: s.isAdmin, threadId: s.threadId, userTokenId: s.userTokenId, serviceUserId: s.serviceUserId };
}

// cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates.entries()) {
    if (now - v.createdAt > 600_000) oauthStates.delete(k);
  }
}, 600_000);


export interface AiAccount {
  id: string;
  name: string;       // display name e.g. "9Router Production"
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: number;
}

const aiAccounts = new Map<string, AiAccount>();

export function createAiAccount(opts: { name: string; baseUrl: string; apiKey: string; model: string }): AiAccount {
  const id = randomUUID();
  const acc: AiAccount = { id, name: opts.name, baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model, createdAt: Date.now() };
  aiAccounts.set(id, acc);
  return acc;
}

export function getAiAccount(id: string): AiAccount | undefined {
  return aiAccounts.get(id);
}

export function listAiAccounts(): AiAccount[] {
  return [...aiAccounts.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteAiAccount(id: string): void {
  aiAccounts.delete(id);
}

// ── User-facing connect tokens ───────────────────────────────────────────────
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

const userTokens = new Map<string, UserToken>();

export function createUserToken(opts: { label: string; aiAccountId: string; fbThreadId: string; ttlHours: number; redirectUrl: string }): UserToken {
  const id = randomUUID();
  const now = Date.now();
  const token: UserToken = {
    id, label: opts.label, aiAccountId: opts.aiAccountId, fbThreadId: opts.fbThreadId,
    createdAt: now, expiresAt: now + opts.ttlHours * 3_600_000,
    usedAt: null, usedByLabel: "", redirectUrl: opts.redirectUrl,
  };
  userTokens.set(id, token);
  return token;
}

export function getUserToken(id: string): UserToken | undefined {
  return userTokens.get(id);
}

export function markUserTokenUsed(id: string, byLabel?: string): void {
  const t = userTokens.get(id);
  if (t) { t.usedAt = Date.now(); if (byLabel) t.usedByLabel = byLabel.slice(0, 120); }
}

export function deleteUserToken(id: string): void { userTokens.delete(id); }

export function listUserTokens(): UserToken[] {
  return [...userTokens.values()].sort((a, b) => b.createdAt - a.createdAt);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, t] of userTokens.entries()) { if (t.expiresAt < now) userTokens.delete(id); }
}, 600_000);

// ── Per-user Gemini AI config (keyed by FB thread ID) ────────────────────────
export interface UserAiConfig {
  threadId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry: number;   // epoch ms
  model: string;
  connectedAt: number;
}

const userAiConfigs = new Map<string, UserAiConfig>();

export function setUserAiConfig(config: UserAiConfig): void {
  userAiConfigs.set(config.threadId, config);
}

export function getUserAiConfig(threadId: string): UserAiConfig | undefined {
  return userAiConfigs.get(threadId);
}

export function updateUserAiModel(threadId: string, model: string): boolean {
  const config = userAiConfigs.get(threadId);
  if (!config) return false;
  config.model = model;
  return true;
}

export async function fetchGeminiModels(accessToken: string): Promise<string[]> {
  const fallbackModels = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];
  if (!accessToken) return fallbackModels;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      };
      const list = (data.models ?? [])
        .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace(/^models\//, ""))
        .filter(name => !name.includes("embedding") && !name.includes("aqa") && !name.includes("imagen"));
      if (list.length > 0) {
        return Array.from(new Set(list));
      }
    }
  } catch {
    // Network or quota error; return standard fallback models
  }
  return fallbackModels;
}

export function deleteUserAiConfig(threadId: string): void {
  userAiConfigs.delete(threadId);
}

export function listUserAiConfigs(): UserAiConfig[] {
  return [...userAiConfigs.values()].sort((a, b) => b.connectedAt - a.connectedAt);
}

// ── Managed service users ─────────────────────────────────────────────────────
export interface ServiceUser {
  id: string;
  name: string;
  passwordHash: string;
  fbThreadId: string;
  active: boolean;
  createdAt: number;
}

const serviceUsers = new Map<string, ServiceUser>();
const userSessions = new Map<string, { userId: string; expiresAt: number }>();

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

export function createServiceUser(opts: { id: string; name: string; password: string; fbThreadId: string }): ServiceUser {
  const id = opts.id.toLowerCase();
  if (serviceUsers.has(id)) throw new Error("ID nguoi dung da ton tai.");
  const user: ServiceUser = { id, name: opts.name, passwordHash: hashPassword(opts.password), fbThreadId: opts.fbThreadId, active: true, createdAt: Date.now() };
  serviceUsers.set(id, user);
  return user;
}

export function getServiceUser(id: string): ServiceUser | undefined { return serviceUsers.get(id.toLowerCase()); }
export function listServiceUsers(): ServiceUser[] { return [...serviceUsers.values()].sort((a, b) => b.createdAt - a.createdAt); }
export function deleteServiceUser(id: string): void {
  serviceUsers.delete(id.toLowerCase());
  for (const [sessionId, session] of userSessions) if (session.userId === id.toLowerCase()) userSessions.delete(sessionId);
}
export function setServiceUserActive(id: string, active: boolean): void {
  const user = getServiceUser(id);
  if (user) user.active = active;
}
export function createUserSession(userId: string): string {
  const sessionId = randomBytes(32).toString("hex");
  userSessions.set(sessionId, { userId, expiresAt: Date.now() + 7 * 24 * 3_600_000 });
  return sessionId;
}
export function authenticateServiceUser(id: string, password: string): ServiceUser | undefined {
  const user = getServiceUser(id);
  return user?.active && verifyPassword(password, user.passwordHash) ? user : undefined;
}
export function getSessionUser(sessionId?: string): ServiceUser | undefined {
  if (!sessionId) return undefined;
  const session = userSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) { userSessions.delete(sessionId); return undefined; }
  const user = getServiceUser(session.userId);
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
