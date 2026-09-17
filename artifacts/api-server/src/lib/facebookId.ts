// Resolves a Facebook profile link to its numeric user ID (and, best-effort,
// its display name) via the free id.traodoisub.com lookup service, with a
// safe manual fallback: the service sits behind Cloudflare's bot-challenge,
// so automated requests frequently get blocked outright. We treat that as a
// normal, expected failure mode (not a crash) and let the caller fall back
// to a directly-pasted numeric ID — name lookup failing is never fatal on
// its own, since the caller can always fall back to a generic name.

const FB_ID_API = "https://id.traodoisub.com/api.php";
const NUMERIC_ID = /\b(\d{5,20})\b/;
const FB_LINK = /^https?:\/\/(www\.|m\.|web\.)?(facebook|fb)\.com\//i;

export interface ResolveFbIdResult {
  ok: boolean;
  id?: string;
  name?: string;
  error?: string;
}

export async function resolveFacebookId(input: string): Promise<ResolveFbIdResult> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Vui lòng nhập link Facebook." };

  // Admin already has the numeric ID (e.g. lookup service was down last
  // time) — nothing to resolve, and no link to pull a name from either.
  if (/^\d{5,20}$/.test(raw)) return { ok: true, id: raw };

  // "profile.php?id=NNNN" links already carry the numeric ID in the URL —
  // no need to round-trip through the (Cloudflare-flaky) lookup API just
  // for the ID. We still try the API below (best-effort) to also grab the
  // display name, but the ID itself is already known here.
  const shortcutId = raw.match(/[?&]id=(\d{5,20})\b/)?.[1];

  if (!FB_LINK.test(raw)) {
    if (shortcutId) return { ok: true, id: shortcutId };
    return { ok: false, error: "Link Facebook không hợp lệ. Ví dụ: https://facebook.com/ten-nguoi-dung (hoặc dán thẳng ID số)." };
  }

  let status: number;
  let text: string;
  try {
    const res = await fetch(`${FB_ID_API}?link=${encodeURIComponent(raw)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    text = await res.text();
  } catch (err: any) {
    if (shortcutId) return { ok: true, id: shortcutId };
    return { ok: false, error: `Không kết nối được dịch vụ tra cứu ID (${err?.message ?? "lỗi mạng"}). Vui lòng dán ID Facebook (dạng số) trực tiếp.` };
  }

  // The lookup service is Cloudflare-protected and often returns an
  // interactive JS-challenge page instead of real data. Detect that
  // explicitly and refuse to guess — otherwise a naive "grab any long
  // digit run" fallback could mistake a Cloudflare timestamp/ray-ID
  // embedded in the challenge HTML for a real Facebook ID.
  const looksBlocked = status !== 200 || /just a moment|cf_chl_opt|cloudflare|enable javascript/i.test(text);
  if (looksBlocked) {
    if (shortcutId) return { ok: true, id: shortcutId };
    return { ok: false, error: "Dịch vụ tra cứu ID đang chặn truy cập tự động (Cloudflare). Vui lòng dán ID Facebook (dạng số) trực tiếp thay vì link." };
  }

  let apiId: string | undefined;
  let apiName: string | undefined;
  try {
    const data = JSON.parse(text);
    const idCandidate = data?.id ?? data?.uid ?? data?.data ?? data?.result ?? data?.fb_id;
    if (idCandidate) {
      const m = String(idCandidate).match(NUMERIC_ID);
      if (m) apiId = m[1];
    }
    const nameCandidate = data?.name ?? data?.fullname ?? data?.full_name ?? data?.username ?? data?.display_name;
    if (typeof nameCandidate === "string" && nameCandidate.trim()) apiName = nameCandidate.trim().slice(0, 80);
  } catch {
    // Not JSON — fall through to plain-text ID extraction below (no name available in this shape).
  }

  if (!apiId) {
    const m = text.match(NUMERIC_ID);
    if (m) apiId = m[1];
  }

  const finalId = shortcutId ?? apiId;
  if (!finalId) {
    return { ok: false, error: "Không đọc được ID từ phản hồi dịch vụ tra cứu. Vui lòng dán ID Facebook (dạng số) trực tiếp." };
  }
  return { ok: true, id: finalId, name: apiName };
}
