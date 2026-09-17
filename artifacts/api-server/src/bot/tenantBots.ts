// Registry of per-customer Facebook bot instances. Each customer who
// connects their own Facebook account (from their /u/:id page) gets one
// FacebookBotEngine, fully independent from the shared admin bot in
// facebook.ts and from every other tenant's engine.
import * as fs from "fs";
import * as path from "path";
import { FacebookBotEngine, type LoginCredentials, type EngineState } from "./facebookEngine";
import { getServiceUser } from "../lib/adminAuth";

const STATE_BASE = process.env.STATE_DIR ?? path.join(process.cwd(), "dist");

// Hard cap on concurrent tenant browsers so a burst of customers connecting
// can't OOM the shared Railway instance. Raise via env once infra is scaled.
export const MAX_TENANT_BOTS = Number(process.env["MAX_TENANT_BOTS"] ?? 5);

interface TenantSession {
  engine: FacebookBotEngine;
  state: EngineState;
}

const sessions = new Map<string, TenantSession>();

function createSession(ownerId: string): TenantSession {
  const state: EngineState = { status: "stopped", error: null, startedAt: null, messagesHandled: 0 };
  const engine = new FacebookBotEngine({
    id: ownerId,
    state,
    // Tenant bots always try to reply — there's no separate global toggle
    // or ignore-list for a customer's own inbox (v1 scope).
    autoReplyEnabled: () => true,
    isThreadIgnored: () => false,
    resolveReply: async (threadId) => {
      // Re-fetch fresh each message so replyMode/threadIds/systemPrompt
      // changes the customer makes on /u/:id take effect immediately.
      const owner = await getServiceUser(ownerId);
      if (!owner || !owner.active) return null;
      if (owner.replyMode === "specific" && !owner.threadIds.includes(threadId)) return null;
      return { ownerKey: owner.id, systemPrompt: owner.systemPrompt };
    },
    // No onUnresolvedThread: a tenant's own bot just stays silent on
    // conversations it isn't configured to answer — no connect-link concept.
  });
  return { engine, state };
}

function getOrCreateSession(ownerId: string): TenantSession {
  let session = sessions.get(ownerId);
  if (!session) {
    session = createSession(ownerId);
    sessions.set(ownerId, session);
  }
  return session;
}

export async function startTenantBot(ownerId: string, credentials: LoginCredentials): Promise<void> {
  const activeElsewhere = [...sessions.entries()].filter(([id, s]) =>
    id !== ownerId && (s.state.status === "running" || s.state.status === "connecting" || s.state.status === "waiting_2fa")
  ).length;
  if (activeElsewhere >= MAX_TENANT_BOTS) {
    throw new Error(`Đã đạt giới hạn ${MAX_TENANT_BOTS} bot chạy đồng thời trên hệ thống. Vui lòng thử lại sau.`);
  }
  const session = getOrCreateSession(ownerId);
  await session.engine.start(credentials);
}

export function stopTenantBot(ownerId: string): void {
  sessions.get(ownerId)?.engine.stop();
}

export async function submitTenantBot2FA(ownerId: string, code: string): Promise<void> {
  const session = sessions.get(ownerId);
  if (!session) throw new Error("Không có phiên đang chờ xác minh 2FA. Vui lòng kết nối lại.");
  await session.engine.submit2FACode(code);
}

export function getTenantBotState(ownerId: string): EngineState | undefined {
  return sessions.get(ownerId)?.state;
}

/** Restart any tenant bots that were running before a redeploy (mirrors the
 *  admin bot's canAutoRestart()/startBot() pattern in index.ts, scanning the
 *  same STATE_DIR volume for per-tenant autostart flags instead of the one
 *  shared flag). */
export function restoreTenantBotsOnBoot(): void {
  if (!fs.existsSync(STATE_BASE)) return;
  const flagPattern = /^autostart-(.+)\.flag$/;
  for (const file of fs.readdirSync(STATE_BASE)) {
    const match = file.match(flagPattern);
    if (!match) continue;
    const ownerId = match[1];
    const statePath = path.join(STATE_BASE, `browser-state-${ownerId}.json`);
    if (!fs.existsSync(statePath)) continue;
    const session = getOrCreateSession(ownerId);
    session.engine.start({ type: "appstate", appState: [] }).catch(() => {
      // Failure is already recorded on session.state by the engine itself.
    });
  }
}
