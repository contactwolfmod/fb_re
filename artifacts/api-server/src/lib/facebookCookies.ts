// Shared by the admin bot's cookie-paste form (routes/bot.ts) and each
// tenant's own "connect Facebook" form (routes/user.ts) — parses whatever
// format a customer is likely to paste from their browser's DevTools into
// the AppState array format fca-unofficial expects.

/**
 * Convert cookie string (e.g. "c_user=123; xs=abc") to AppState array format
 * used by fca-unofficial.
 */
export function cookieStringToAppState(cookieStr: string): any[] {
  return cookieStr
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return null;
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      return {
        key,
        value,
        domain: ".facebook.com",
        path: "/",
        hostOnly: false,
        creation: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

/**
 * Parse AppState from user input — accepts:
 *   1. JSON array (fca-unofficial native format)
 *   2. Cookie string "c_user=xxx; xs=xxx; ..."
 */
export function parseAppState(raw: string): { parsed: any[]; error?: string } {
  const trimmed = raw.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { parsed: [], error: "AppState phải là một JSON array" };
      }
      if (parsed.length === 0) {
        return { parsed: [], error: "AppState array không được rỗng" };
      }
      return { parsed };
    } catch (e: any) {
      return { parsed: [], error: "JSON không hợp lệ: " + e.message };
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      return { parsed: [obj] };
    } catch (e: any) {
      return { parsed: [], error: "JSON object không hợp lệ: " + e.message };
    }
  }

  if (trimmed.includes("=")) {
    const converted = cookieStringToAppState(trimmed);
    if (converted.length === 0) {
      return { parsed: [], error: "Không thể đọc cookie string" };
    }
    return { parsed: converted };
  }

  return {
    parsed: [],
    error:
      "Định dạng không hợp lệ. Cần JSON array ([{...},...]) hoặc cookie string (c_user=xxx; xs=xxx; ...)",
  };
}

/** Validate the two cookies fca-unofficial absolutely needs to log in. */
export function validateRequiredCookies(parsed: any[]): string | null {
  const keys = parsed.map((c: any) => (c.key ?? c.name ?? "").toLowerCase());
  if (!keys.includes("xs")) {
    return "Cookie thiếu 'xs' — đây là cookie quan trọng nhất. Vui lòng copy lại đủ cookie từ DevTools (bao gồm xs, c_user, datr).";
  }
  if (!keys.includes("c_user")) {
    return "Cookie thiếu 'c_user' (ID Facebook). Vui lòng copy lại đủ cookie.";
  }
  return null;
}
