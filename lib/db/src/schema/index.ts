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
  // Per-customer AI system prompt, self-configured from /u/:id. Empty string
  // means "use the bot's global default prompt" (botState.systemPrompt).
  systemPrompt: text("system_prompt").notNull().default(""),
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

// ── Per-owner AI config (deprecated: single account per owner) ──────────────
// Kept for backward compat. New flow uses userAiAccountsTable below.
export const userAiConfigsTable = pgTable("user_ai_configs", {
  ownerKey: text("owner_key").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: bigint("token_expiry", { mode: "number" }).notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  providerLabel: text("provider_label"),
  connectedAt: bigint("connected_at", { mode: "number" }).notNull(),
});

// ── Per-owner Multiple AI Accounts (new flow) ──────────────────────────────
// Hỗ trợ nhiều tài khoản AI (Gemini, ChatGPT, Claude, ...) cho mỗi owner.
// ownerKey: service user ID hoặc FB thread ID (như userAiConfigsTable)
// providerId: dạng "gemini", "openai", "claude", "openrouter", etc.
// accountName: tên account do khách đặt (e.g. "Gemini Main", "ChatGPT Premium")
// accessToken: OAuth token (Gemini) hoặc API key (ChatGPT, Claude, ...)
// refreshToken: chỉ cho OAuth providers (Gemini)
// tokenExpiry: timestamp hết hạn token
// model: mô hình mặc định cho account này (e.g. "gemini-3.8-flash", "gpt-4o")
// baseUrl: nếu custom OpenAI-compatible endpoint, nếu không để null
// quotaUsed: số token/credits đã dùng (tracking usage)
// quotaLimit: giới hạn quota mỗi tháng (0 = unlimited)
// quotaResetAt: timestamp reset quota hàng tháng
// isActive: account đang kích hoạt không (khách có thể pause account)
// createdAt: khi được thêm vào
export const userAiAccountsTable = pgTable("user_ai_accounts", {
  id: text("id").primaryKey(), // "ownerKey:providerId:accountName"
  ownerKey: text("owner_key").notNull(),
  providerId: text("provider_id").notNull(), // "gemini", "openai", "claude", etc.
  accountName: text("account_name").notNull(), // người dùng tự đặt tên
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: bigint("token_expiry", { mode: "number" }),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  quotaUsed: bigint("quota_used", { mode: "number" }).notNull().default(0),
  quotaLimit: bigint("quota_limit", { mode: "number" }).notNull().default(0), // 0 = unlimited
  quotaResetAt: bigint("quota_reset_at", { mode: "number" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── Per-owner Active AI Account (which account to use) ──────────────────────
// ownerKey chỉ trỏ tới 1 account đang sử dụng ở userAiAccountsTable.id
// Khách có thể thay đổi account nào đang dùng từ giao diện web.
export const userAiActiveAccountsTable = pgTable("user_ai_active_accounts", {
  ownerKey: text("owner_key").primaryKey(),
  activeAccountId: text("active_account_id").notNull(), // refers to userAiAccountsTable.id
  changedAt: bigint("changed_at", { mode: "number" }).notNull(),
});
