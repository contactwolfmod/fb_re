// Resolves a Facebook profile link to its numeric user ID (and, best-effort,
// its display name). Tries two independent sources, since either can fail
// on its own and there's no reason to give up just because one is down:
//
//   1. Facebook's own Open Graph tags (fb://profile/<id> in al:*:url, and
//      og:title for the name) — read straight off the public profile page.
//      This is a long-stable technique: Facebook deliberately keeps these
//      tags crawlable (un-JS'd, server-rendered) so link previews work on
//      WhatsApp/Messenger/etc., so a plain GET tends to succeed even where
//      heavier scraping gets blocked.
//   2. id.traodoisub.com, a free public lookup API — kept as a second
//      attempt, but it sits behind Cloudflare's bot-challenge and often
//      blocks automated requests outright (confirmed blocked even from
//      Railway's IPs, not just a local dev machine).
//
// Either source failing is a normal, expected outcome, not a crash — the
// caller always has a manual fallback: paste the numeric ID directly.

const FB_ID_API = "https://id.traodoisub.com/api.php";
const NUMERIC_ID = /\b(\d{5,20})\b/;
const FB_LINK = /^https?:\/\/(www\.|m\.|web\.|mbasic\.)?(facebook|fb)\.com\//i;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ResolveFbIdResult {
  ok: boolean;
  id?: string;
  name?: string;
  error?: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Read the numeric ID + display name straight off Facebook's own Open
 *  Graph tags on the public profile page. Best-effort: returns whatever it
 *  could find, or an empty object if the fetch/parse fails for any reason. */
async function scrapeOpenGraphProfile(url: string): Promise<{ id?: string; name?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const html = await res.text();

    // "al:android:url"/"al:ios:url" deep-link tags: content="fb://profile/<id>"
    let id = html.match(/fb:\/\/(?:profile|page|group)\/(\d{5,20})/)?.[1];
    // Fallback: canonical/redirect URL sometimes carries profile.php?id=NNNN
    if (!id) id = html.match(/profile\.php\?id=(\d{5,20})/)?.[1];

    const titleMatch =
      html.match(/property="og:title"\s+content="([^"]+)"/i) ??
      html.match(/content="([^"]+)"\s+property="og:title"/i);
    const name = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim().slice(0, 80) : undefined;

    return { id, name: name || undefined };
  } catch {
    return {};
  }
}

async function lookupViaTraodoisub(url: string): Promise<{ id?: string; name?: string; blocked: boolean }> {
  let status: number;
  let text: string;
  try {
    const res = await fetch(`${FB_ID_API}?link=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": BROWSER_UA, "Accept": "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    text = await res.text();
  } catch {
    return { blocked: false };
  }

  // The lookup service is Cloudflare-protected and often returns an
  // interactive JS-challenge page instead of real data. Detect that
  // explicitly and refuse to guess — otherwise a naive "grab any long
  // digit run" fallback could mistake a Cloudflare timestamp/ray-ID
  // embedded in the challenge HTML for a real Facebook ID.
  const looksBlocked = status !== 200 || /just a moment|cf_chl_opt|cloudflare|enable javascript/i.test(text);
  if (looksBlocked) return { blocked: true };

  let id: string | undefined;
  let name: string | undefined;
  try {
    const data = JSON.parse(text);
    const idCandidate = data?.id ?? data?.uid ?? data?.data ?? data?.result ?? data?.fb_id;
    if (idCandidate) id = String(idCandidate).match(NUMERIC_ID)?.[1];
    const nameCandidate = data?.name ?? data?.fullname ?? data?.full_name ?? data?.username ?? data?.display_name;
    if (typeof nameCandidate === "string" && nameCandidate.trim()) name = nameCandidate.trim().slice(0, 80);
  } catch {
    id = text.match(NUMERIC_ID)?.[1];
  }
  return { id, name, blocked: false };
}

export async function resolveFacebookId(input: string): Promise<ResolveFbIdResult> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Vui lòng nhập link Facebook." };

  // Admin already has the numeric ID (e.g. lookup failed last time) —
  // nothing to resolve, and no link to pull a name from either.
  if (/^\d{5,20}$/.test(raw)) return { ok: true, id: raw };

  // "profile.php?id=NNNN" links already carry the numeric ID in the URL —
  // no need to fetch anything just for the ID (still worth scraping for
  // the display name below).
  const shortcutId = raw.match(/[?&]id=(\d{5,20})\b/)?.[1];

  if (!FB_LINK.test(raw)) {
    if (shortcutId) return { ok: true, id: shortcutId };
    return { ok: false, error: "Link Facebook không hợp lệ. Ví dụ: https://facebook.com/ten-nguoi-dung (hoặc dán thẳng ID số)." };
  }

  const og = await scrapeOpenGraphProfile(raw);
  const haveId = !!(shortcutId || og.id);
  const haveName = !!og.name;
  // Only worth the second (Cloudflare-flaky) network call if OG scraping
  // didn't already give us everything we need.
  const traodoisub = (haveId && haveName) ? { blocked: false as const } : await lookupViaTraodoisub(raw);

  const finalId = shortcutId ?? og.id ?? traodoisub.id;
  const finalName = og.name ?? traodoisub.name;

  if (!finalId) {
    const reason = traodoisub.blocked
      ? "Dịch vụ tra cứu dự phòng cũng đang bị chặn truy cập tự động (Cloudflare)."
      : "Không đọc được ID từ trang Facebook hoặc dịch vụ tra cứu.";
    return { ok: false, error: `${reason} Vui lòng dán ID Facebook (dạng số) trực tiếp.` };
  }
  return { ok: true, id: finalId, name: finalName };
}
