import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

// Admin token from env (required). If not set, admin routes return 503.
export const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// Google OAuth env
export const GOOGLE_CLIENT_ID = process.env["GOOGLE_CLIENT_ID"] ?? "";
export const GOOGLE_CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

// Gemini OpenAI-compatible base URL
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

// ── Google OAuth states (short-lived, server-side CSRF protection) ────────────
const oauthStates = new Map<string, { createdAt: number; isAdmin: boolean }>();

export function createOAuthState(isAdmin: boolean): string {
  const state = randomUUID();
  oauthStates.set(state, { createdAt: Date.now(), isAdmin });
  return state;
}

export function consumeOAuthState(state: string): { isAdmin: boolean } | undefined {
  const s = oauthStates.get(state);
  if (!s) return undefined;
  oauthStates.delete(state);
  // expire after 10 min
  if (Date.now() - s.createdAt > 600_000) return undefined;
  return { isAdmin: s.isAdmin };
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
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByLabel: string;
  redirectUrl: string;
}

const userTokens = new Map<string, UserToken>();

export function createUserToken(opts: { label: string; aiAccountId: string; ttlHours: number; redirectUrl: string }): UserToken {
  const id = randomUUID();
  const now = Date.now();
  const token: UserToken = {
    id, label: opts.label, aiAccountId: opts.aiAccountId,
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

// ── Middleware ────────────────────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_TOKEN) { res.status(503).json({ error: "ADMIN_TOKEN env chua duoc dat." }); return; }
  const cookie = (req as any).cookies?.["adminToken"] as string | undefined;
  if (cookie && cookie === ADMIN_TOKEN) { next(); return; }
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === ADMIN_TOKEN) { next(); return; }
  res.status(401).json({ error: "Chua dang nhap admin" });
}
