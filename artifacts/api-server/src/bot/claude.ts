import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import { botState } from "./state";
import { getUserAiConfig, resolveServiceUserForThread, GEMINI_BASE_URL } from "../lib/adminAuth";

// ── Static fallback clients (Replit / Anthropic / GitHub) ────────────────
const replitBaseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
const replitApiKey  = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
const anthropicKey  = process.env["ANTHROPIC_API_KEY"];
const githubToken   = process.env["GITHUB_TOKEN"] ?? process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];

type Provider = "anthropic" | "openai-compat" | "gemini-code-assist" | "none";

let staticProvider: Provider = "none";
let staticAnthropicClient: Anthropic | undefined;
let staticOpenaiClient: OpenAI | undefined;
let staticDefaultModel = "claude-sonnet-4-6";

if (replitBaseURL && replitApiKey) {
  staticProvider = "anthropic";
  staticAnthropicClient = new Anthropic({ baseURL: replitBaseURL, apiKey: replitApiKey });
  staticDefaultModel = process.env["AI_MODEL"] ?? "claude-sonnet-4-6";
  logger.info("Claude: using Replit AI integration proxy");
} else if (anthropicKey) {
  staticProvider = "anthropic";
  staticAnthropicClient = new Anthropic({ apiKey: anthropicKey });
  staticDefaultModel = process.env["AI_MODEL"] ?? "claude-sonnet-4-6";
  logger.info("Claude: using direct Anthropic API");
} else if (githubToken) {
  staticProvider = "openai-compat";
  staticOpenaiClient = new OpenAI({ baseURL: "https://models.inference.ai.azure.com", apiKey: githubToken });
  staticDefaultModel = process.env["AI_MODEL"] ?? "gpt-4o-mini";
  logger.info("Claude: using GitHub Models free tier");
} else {
  logger.warn("Chua cau hinh AI tinh. Bot se dung cau hinh 9Router tu botState.");
}

// ── Resolve AI client — dynamic (botState) takes priority over static ────
interface ResolvedClient {
  provider: Provider;
  anthropicClient?: Anthropic;
  openaiClient?: OpenAI;
  accessToken?: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

async function resolveClient(threadId?: string, ownerKeyOverride?: string): Promise<ResolvedClient> {
  // Per-user Gemini config takes highest priority. Callers that already
  // know the owner (e.g. a per-tenant Facebook bot instance, or the shared
  // bot after it already resolved the thread) pass ownerKeyOverride to skip
  // resolution entirely. Otherwise resolve the owning service user first
  // (their config is keyed by their account ID, shared across all of their
  // configured threads); fall back to the raw threadId for the legacy
  // one-off connect-link flow that has no service user account.
  const effectiveOwnerKey = ownerKeyOverride
    ?? (threadId ? (await resolveServiceUserForThread(threadId))?.id : undefined)
    ?? threadId;
  if (effectiveOwnerKey) {
    const userConfig = await getUserAiConfig(effectiveOwnerKey);
    if (userConfig && userConfig.accessToken) {
      if (userConfig.baseUrl) {
        return {
          provider: "openai-compat",
          openaiClient: new OpenAI({ baseURL: userConfig.baseUrl, apiKey: userConfig.accessToken }),
          model: userConfig.model,
          timeoutMs: botState.aiTimeoutMs,
          maxTokens: botState.aiMaxTokens,
        };
      }
      return {
        provider: "gemini-code-assist",
        accessToken: userConfig.accessToken,
        model: userConfig.model,
        timeoutMs: botState.aiTimeoutMs,
        maxTokens: botState.aiMaxTokens,
      };
    }
  }
  const dynamicBaseUrl = botState.aiBaseUrl;
  const dynamicApiKey  = botState.aiApiKey;
  if (dynamicBaseUrl && dynamicApiKey) {
    if (dynamicBaseUrl === GEMINI_BASE_URL) {
      return {
        provider: "gemini-code-assist",
        accessToken: dynamicApiKey,
        model: botState.aiModel,
        timeoutMs: botState.aiTimeoutMs,
        maxTokens: botState.aiMaxTokens,
      };
    }
    return {
      provider: "openai-compat",
      openaiClient: new OpenAI({ baseURL: dynamicBaseUrl, apiKey: dynamicApiKey }),
      model: botState.aiModel,
      timeoutMs: botState.aiTimeoutMs,
      maxTokens: botState.aiMaxTokens,
    };
  }
  if (staticProvider === "anthropic" && staticAnthropicClient) {
    return { provider: "anthropic", anthropicClient: staticAnthropicClient, model: staticDefaultModel, timeoutMs: 12000, maxTokens: 500 };
  }
  if (staticProvider === "openai-compat" && staticOpenaiClient) {
    return { provider: "openai-compat", openaiClient: staticOpenaiClient, model: staticDefaultModel, timeoutMs: 12000, maxTokens: 500 };
  }
  return { provider: "none", model: staticDefaultModel, timeoutMs: 12000, maxTokens: 500 };
}

const conversationHistory = new Map<string, { role: "user" | "assistant"; content: string }[]>();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const geminiSetupCache = new Map<string, { projectId: string; expiresAt: number }>();
const GEMINI_CLIENT_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
};

async function postCodeAssist<T>(accessToken: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${GEMINI_BASE_URL}:${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
    throw Object.assign(new Error(message), { status: res.status, details: data });
  }
  return data as T;
}

async function ensureGeminiCodeAssistReady(accessToken: string, signal?: AbortSignal): Promise<string> {
  const cacheKey = accessToken.slice(0, 24);
  const cached = geminiSetupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.projectId;

  const loadReq = {
    metadata: GEMINI_CLIENT_METADATA,
  };
  const loadRes = await postCodeAssist<any>(accessToken, "loadCodeAssist", loadReq, signal);
  let projectId = loadRes?.cloudaicompanionProject as string | undefined;

  if (!projectId) {
    const freeTier = (loadRes?.allowedTiers ?? []).find((t: any) => t?.id === "FREE" || t?.isDefault) ?? loadRes?.currentTier;
    const tierId = freeTier?.id ?? "FREE";
    const onboardRes = await postCodeAssist<any>(accessToken, "onboardUser", {
      tierId,
      cloudaicompanionProject: undefined,
      metadata: GEMINI_CLIENT_METADATA,
    }, signal);
    projectId = onboardRes?.response?.cloudaicompanionProject?.id || onboardRes?.cloudaicompanionProject?.id;
  }

  if (!projectId) {
    const reason = (loadRes?.ineligibleTiers ?? []).map((t: any) => t?.reasonMessage).filter(Boolean).join("; ");
    throw new Error(reason || "Gemini Code Assist chưa sẵn sàng cho tài khoản này.");
  }

  geminiSetupCache.set(cacheKey, { projectId, expiresAt: Date.now() + 30 * 60_000 });
  return projectId;
}

async function callGeminiCodeAssist(opts: {
  accessToken: string;
  model: string;
  history: { role: "user" | "assistant"; content: string }[];
  systemPrompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const projectId = await ensureGeminiCodeAssistReady(opts.accessToken, opts.signal);
  const contents = opts.history.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = {
    model: opts.model,
    project: projectId,
    user_prompt_id: randomId(),
    request: {
      contents,
      systemInstruction: { role: "user", parts: [{ text: opts.systemPrompt }] },
      generationConfig: { maxOutputTokens: opts.maxTokens },
    },
  };
  const data = await postCodeAssist<any>(opts.accessToken, "generateContent", body, opts.signal);
  const parts = data?.response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p: any) => typeof p?.text === "string" ? p.text : "").join("").trim();
  }
  return "";
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getClaudeReply(
  threadId: string,
  userMessage: string,
  systemPrompt: string,
  ownerKeyOverride?: string
): Promise<string> {
  const history = conversationHistory.get(threadId) ?? [];
  history.push({ role: "user", content: userMessage });
  if (history.length > 10) history.splice(0, history.length - 10);

  const { provider, anthropicClient, openaiClient, accessToken, model, timeoutMs, maxTokens } = await resolveClient(threadId, ownerKeyOverride);
  logger.info({ threadId, model, provider }, "Calling AI API");

  try {
    let replyText: string;

    if (provider === "anthropic" && anthropicClient) {
      const response = await withTimeout(anthropicClient.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: history,
      }), timeoutMs, "AI API");
      const block = response.content[0];
      replyText = block.type === "text" ? block.text : "";
    } else if (provider === "gemini-code-assist" && accessToken) {
      replyText = await withTimeout(callGeminiCodeAssist({
        accessToken,
        model,
        history,
        systemPrompt,
        maxTokens,
      }), timeoutMs, "AI API");
    } else if (openaiClient) {
      const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...history,
      ];
      const response = await withTimeout(openaiClient.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: msgs,
      }), timeoutMs, "AI API");
      replyText = response.choices[0]?.message?.content ?? "";
    } else {
      throw new Error("No AI client configured. Add AI_BASE_URL + AI_API_KEY or use AI Config page.");
    }

    logger.info({ threadId, model, replyLen: replyText.length }, "AI API success");
    history.push({ role: "assistant", content: replyText });
    conversationHistory.set(threadId, history);
    return replyText;
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const statusCode = err?.status ?? err?.statusCode ?? null;
    logger.error({ err: errMsg, statusCode, threadId, model, provider }, "AI API error");
    throw err;
  }
}

export function clearConversation(threadId: string) {
  conversationHistory.delete(threadId);
}

export function getConversationLength(threadId: string): number {
  return conversationHistory.get(threadId)?.length ?? 0;
}
