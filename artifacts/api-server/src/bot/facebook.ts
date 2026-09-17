// Thin backward-compatible wrapper around FacebookBotEngine for the single
// shared "admin" bot. All the actual Playwright/scraping/polling logic lives
// in facebookEngine.ts, which this file configures with the shared bot's
// specific reply-resolution rules (resolve by thread → service user → AI
// config, falling back to global/static AI, and sending a Gemini connect
// link when nothing is configured yet). Every export here has the exact
// same signature as before the engine was extracted, so routes/bot.ts and
// index.ts need no changes.
import { botState } from "./state";
import { getUserAiConfig, listUserTokens, resolveServiceUserForThread } from "../lib/adminAuth";
import { FacebookBotEngine, TwoFactorRequired, type LoginCredentials } from "./facebookEngine";

export { TwoFactorRequired };
export type { LoginCredentials };

function hasGlobalAi(): boolean {
  return !!(botState.aiBaseUrl && botState.aiApiKey);
}

function hasStaticAi(): boolean {
  return !!(
    process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ||
    process.env["ANTHROPIC_API_KEY"] ||
    process.env["GITHUB_TOKEN"] ||
    process.env["GITHUB_PERSONAL_ACCESS_TOKEN"]
  );
}

const adminEngine = new FacebookBotEngine({
  id: "admin",
  state: botState,
  autoReplyEnabled: () => botState.autoReplyEnabled,
  isThreadIgnored: (threadId) => botState.ignoredThreadIds.has(threadId),
  resolveReply: async (threadId) => {
    const owner = await resolveServiceUserForThread(threadId);
    const ownerKey = owner?.id ?? threadId;
    const userAiConfig = await getUserAiConfig(ownerKey);
    if (!userAiConfig && !hasGlobalAi() && !hasStaticAi()) return null;
    return { ownerKey, systemPrompt: owner?.systemPrompt || botState.systemPrompt };
  },
  onUnresolvedThread: async (threadId) => {
    // No AI for this thread — send a Gemini connect link if one is pending.
    const tokens = await listUserTokens();
    const userToken = tokens.find(
      (t) => t.fbThreadId === threadId && !t.usedAt && t.expiresAt > Date.now()
    );
    if (!userToken) return null;
    const railwayDomain = process.env["RAILWAY_PUBLIC_DOMAIN"];
    const baseUrl = railwayDomain
      ? `https://${railwayDomain}`
      : `http://localhost:${process.env["PORT"] || 3000}`;
    const connectUrl = `${baseUrl}/connect/gemini?userToken=${userToken.id}`;
    return `Xin chao! De bot co the tra loi, ban can ket noi tai khoan Gemini AI:\n${connectUrl}`;
  },
});

export function startBot(credentials: LoginCredentials): Promise<void> {
  return adminEngine.start(credentials);
}

export function stopBot(): void {
  adminEngine.stop();
}

export function submit2FACode(code: string): Promise<void> {
  return adminEngine.submit2FACode(code);
}

export function canAutoRestart(): boolean {
  return adminEngine.canAutoRestart();
}

export function getFacebookApi() {
  return adminEngine.getFacebookApi();
}
