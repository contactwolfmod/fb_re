import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import { botState } from "./state";

// ── Static fallback clients (Replit / Anthropic / GitHub) ────────────────
const replitBaseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
const replitApiKey  = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
const anthropicKey  = process.env["ANTHROPIC_API_KEY"];
const githubToken   = process.env["GITHUB_TOKEN"] ?? process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];

type Provider = "anthropic" | "openai-compat" | "none";

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
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

function resolveClient(): ResolvedClient {
  const dynamicBaseUrl = botState.aiBaseUrl;
  const dynamicApiKey  = botState.aiApiKey;
  if (dynamicBaseUrl && dynamicApiKey) {
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

export async function getClaudeReply(
  threadId: string,
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const history = conversationHistory.get(threadId) ?? [];
  history.push({ role: "user", content: userMessage });
  if (history.length > 10) history.splice(0, history.length - 10);

  const { provider, anthropicClient, openaiClient, model, timeoutMs, maxTokens } = resolveClient();
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
