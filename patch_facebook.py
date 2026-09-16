import sys

f = r'C:\Users\MSI 15\.cline\data\workspaces\chat\fb_re\artifacts\api-server\src\bot\facebook.ts'
with open(f, encoding='utf-8') as fh:
    c = fh.read()

old = '  blog("info", { threadId, senderID, body: body.substring(0, 80) }, "Message \u2192 Claude");'

new = '''  // Check per-user Gemini config
  const userAiConfig = getUserAiConfig(threadId);
  const hasGlobalAi = !!(botState.aiBaseUrl && botState.aiApiKey);
  const hasStaticAi = !!(
    process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ||
    process.env["ANTHROPIC_API_KEY"] ||
    process.env["GITHUB_TOKEN"] ||
    process.env["GITHUB_PERSONAL_ACCESS_TOKEN"]
  );
  if (!userAiConfig && !hasGlobalAi && !hasStaticAi) {
    // No AI for this thread — send connect link if available
    const tokens = listUserTokens();
    const userToken = tokens.find(
      (t) => t.fbThreadId === threadId && !t.usedAt && t.expiresAt > Date.now()
    );
    if (bPage) {
      const railwayDomain = process.env["RAILWAY_PUBLIC_DOMAIN"];
      const baseUrl = railwayDomain
        ? `https://${railwayDomain}`
        : `http://localhost:${process.env["PORT"] || 3000}`;
      if (userToken) {
        const connectUrl = `${baseUrl}/connect/gemini?userToken=${userToken.id}`;
        blog("info", { threadId }, "No AI config — sending connect link");
        await sendFbMessageUI(
          bPage, threadId,
          `Xin chao! De bot co the tra loi, ban can ket noi tai khoan Gemini AI:\\n${connectUrl}`
        );
      } else {
        blog("warn", { threadId }, "No AI config and no pending connect link for thread — skipping");
      }
    }
    return;
  }

  blog("info", { threadId, senderID, body: body.substring(0, 80) }, "Message \u2192 Claude");'''

if old not in c:
    print("ERROR: old text not found")
    sys.exit(1)

c2 = c.replace(old, new, 1)
with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c2)
print("OK")
