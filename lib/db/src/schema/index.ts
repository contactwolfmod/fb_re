import { pgTable, text, boolean, bigint, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Service users (customers) ──────────────────────────────────────────────
// Reply mode is self-configured by the customer from their own /u/:id page:
// "all" = auto-reply to every incoming Messenger conversation, "specific" =
// only the FB thread IDs in threadIds.
export const serviceUsersTable = pgTable("service_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  replyMode: text("reply_mode").notNull().default("specific"),
  threadIds: jsonb("thread_ids").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
  active: boolean("active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── AI provider accounts (Claude / 9Router / OpenRouter / ...) ─────────────
export const aiAccountsTable = pgTable("ai_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── One-off Gemini connect-link tokens (legacy flow, not tied to a full
// service-user account) ─────────────────────────────────────────────────────
export const userTokensTable = pgTable("user_tokens", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  aiAccountId: text("ai_account_id").notNull().default(""),
  fbThreadId: text("fb_thread_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
  usedByLabel: text("used_by_label").notNull().default(""),
  redirectUrl: text("redirect_url").notNull(),
});

// ── Per-owner Gemini AI config ──────────────────────────────────────────────
// Keyed by "ownerKey": a service user's ID for the self-service flow, or a
// raw FB thread ID for the legacy one-off connect-link flow.
export const userAiConfigsTable = pgTable("user_ai_configs", {
  ownerKey: text("owner_key").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: bigint("token_expiry", { mode: "number" }).notNull(),
  model: text("model").notNull(),
  connectedAt: bigint("connected_at", { mode: "number" }).notNull(),
});
