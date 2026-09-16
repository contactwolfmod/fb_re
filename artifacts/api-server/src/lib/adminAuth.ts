import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

// Admin token from env (required). If not set, admin routes return 503.
export const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// ── User-facing connect tokens ───────────────────────────────────────────────
// Admin generates these short-lived tokens. Each allows ONE connect flow.
export interface UserToken {
  id: string;
  label: string;          // human label set by admin
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;  // null = not yet used
  usedByLabel: string;    // name/email user entered when they authorized
  redirectUrl: string;    // where to send user after connect
}

const userTokens = new Map<string, UserToken>();

export function createUserToken(opts: { label: string; ttlHours: number; redirectUrl: string }): UserToken {
  const id = randomUUID();
  const now = Date.now();
  const token: UserToken = {
    id,
    label: opts.label,
    createdAt: now,
    expiresAt: now + opts.ttlHours * 3_600_000,
    usedAt: null,
    usedByLabel: "",
    redirectUrl: opts.redirectUrl,
  };
  userTokens.set(id, token);
  return token;
}

export function getUserToken(id: string): UserToken | undefined {
  return userTokens.get(id);
}

export function markUserTokenUsed(id: string, byLabel?: string): void {
  const t = userTokens.get(id);
  if (t) {
    t.usedAt = Date.now();
    if (byLabel) t.usedByLabel = byLabel.slice(0, 120);
  }
}

export function deleteUserToken(id: string): void {
  userTokens.delete(id);
}

export function listUserTokens(): UserToken[] {
  return [...userTokens.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// Auto-expire cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of userTokens.entries()) {
    if (t.expiresAt < now) userTokens.delete(id);
  }
}, 600_000);

// ── Middleware ────────────────────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "ADMIN_TOKEN env chua duoc dat. Admin bi tat." });
    return;
  }
  const cookie = (req as any).cookies?.["adminToken"] as string | undefined;
  if (cookie && cookie === ADMIN_TOKEN) {
    next();
    return;
  }
  // Allow Bearer header too (for curl)
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === ADMIN_TOKEN) {
    next();
    return;
  }
  res.status(401).json({ error: "Chua dang nhap admin" });
}