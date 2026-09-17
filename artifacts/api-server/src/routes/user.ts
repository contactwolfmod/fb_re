import { Router, type Request, type Response } from "express";
import {
  authenticateServiceUser,
  createUserSession,
  deleteUserSession,
  getSessionUser,
  getServiceUser,
  getUserAiConfig,
  setUserAiConfig,
  deleteUserAiConfig,
  updateUserAiModel,
  fetchGeminiModels,
  setServiceUserReplyMode,
  addServiceUserThread,
  removeServiceUserThread,
  setServiceUserSystemPrompt,
  type ServiceUser,
} from "../lib/adminAuth";
import { getClaudeReply } from "../bot/claude";
import { botState } from "../bot/state";
import { icon } from "../lib/icons";
import { startTenantBot, stopTenantBot, submitTenantBot2FA, getTenantBotState, hasTenantSavedSession } from "../bot/tenantBots";
import { TwoFactorRequired, type LoginCredentials } from "../bot/facebookEngine";
import { parseAppState, validateRequiredCookies } from "../lib/facebookCookies";

const router = Router();
const validId = /^[a-z0-9-]{3,48}$/;
const validModel = /^[a-zA-Z0-9._:/-]{2,100}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
const initialOf = (name: string) => { const t = name.trim(); return t ? t.charAt(0).toUpperCase() : "?"; };

function css() {
  return `
    :root{
      --bg:#0b0b18;--accent:#e94560;--accent-dark:#c23152;--accent-soft:rgba(233,69,96,.13);
      --surface:rgba(255,255,255,.03);--surface-hover:rgba(255,255,255,.055);
      --border:rgba(255,255,255,.08);--border-soft:rgba(255,255,255,.06);
      --card:rgba(18,18,42,.72);
      --text:#f8fafc;--text-dim:#94a3b8;--text-mute:#64748b;
      --success:#4ade80;--success-soft:rgba(52,211,153,.1);
      --danger:#f87171;--danger-soft:rgba(233,69,96,.1);
      --input-bg:rgba(255,255,255,.04);
      --chat-bg:rgba(0,0,0,.18);
      --bot-msg:rgba(255,255,255,.05);--bot-msg-text:#e2e8f0;
      --shadow-card:0 16px 44px rgba(0,0,0,.35);
      --mono-accent:#818cf8;
      --glow-1:rgba(233,69,96,.13);--glow-2:rgba(56,189,248,.09);
      --radius-lg:18px;--radius-md:13px;--radius-sm:9px;
      --font:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
    }
    html[data-theme="light"]{
      --bg:#f4f6fb;--accent:#e11d48;--accent-dark:#be123c;--accent-soft:rgba(225,29,72,.1);
      --surface:rgba(16,24,40,.03);--surface-hover:rgba(16,24,40,.06);
      --border:rgba(16,24,40,.12);--border-soft:rgba(16,24,40,.08);
      --card:rgba(255,255,255,.9);
      --text:#101828;--text-dim:#475467;--text-mute:#667085;
      --success:#15803d;--success-soft:rgba(22,163,74,.12);
      --danger:#dc2626;--danger-soft:rgba(220,38,38,.1);
      --input-bg:rgba(16,24,40,.03);
      --chat-bg:rgba(16,24,40,.03);
      --bot-msg:rgba(16,24,40,.06);--bot-msg-text:#1f2937;
      --shadow-card:0 12px 32px rgba(16,24,40,.1);
      --mono-accent:#4f46e5;
      --glow-1:rgba(225,29,72,.08);--glow-2:rgba(37,99,235,.07);
    }
    html,body{transition:background-color .25s ease,color .25s ease}

    .theme-btn{background:var(--surface);border:1px solid var(--border);color:var(--text-dim);border-radius:9px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
    .theme-btn:hover{color:var(--text);border-color:var(--accent);background:var(--surface-hover)}
    .theme-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .header-actions{display:flex;align-items:center;gap:8px}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;background-image:radial-gradient(circle at 8% 0%,var(--glow-1),transparent 30%),radial-gradient(circle at 92% 8%,var(--glow-2),transparent 26%);background-attachment:fixed}
    a{color:inherit}
    .page-wrap{max-width:1320px;margin:0 auto;padding:36px 28px 70px}

    /* horizontal two-column layout: config on the left, AI status + live test chat pinned on the right */
    .layout-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start}
    .col-stack{display:flex;flex-direction:column;gap:18px;min-width:0}
    .sidebar-col{position:sticky;top:24px}

    /* login */
    body.login-body{display:flex;align-items:center;justify-content:center;padding:24px}
    .login-card{background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(233,69,96,.16);border-radius:var(--radius-lg);padding:36px 34px;width:100%;max-width:400px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
    .login-mark{width:50px;height:50px;border-radius:13px;background:linear-gradient(135deg,var(--accent),var(--accent-dark));display:grid;place-items:center;color:#fff;box-shadow:0 0 26px rgba(233,69,96,.4);margin-bottom:16px}
    .login-card h1{font-size:1.25rem;font-weight:800;margin:0 0 .3rem}
    .login-card .sub{color:var(--text-dim);font-size:.85rem;margin-bottom:1.4rem}

    /* header */
    .user-header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px;flex-wrap:wrap}
    .user-id{display:flex;align-items:center;gap:13px}
    .avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,rgba(233,69,96,.4),rgba(194,49,82,.4));display:grid;place-items:center;font-weight:800;font-size:1.05rem;color:#fca5b5;flex:none;border:1px solid rgba(233,69,96,.28)}
    .uh-name{font-size:1.15rem;font-weight:800;color:var(--text)}
    .uh-sub{margin-top:3px}

    /* shared primitives */
    .badge{display:inline-flex;align-items:center;gap:6px;padding:.2rem .6rem .2rem .5rem;border-radius:99px;font-size:.7rem;font-weight:700}
    .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
    .badge-ok{background:var(--success-soft);color:#4ade80}
    .badge-used{background:rgba(255,255,255,.05);color:#94a3b8}
    .badge-exp{background:var(--danger-soft);color:#f87171}

    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.6rem 1.1rem;border-radius:9px;font-weight:650;font-size:.85rem;cursor:pointer;border:none;transition:all .15s;font-family:inherit;white-space:nowrap}
    .btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#fff;box-shadow:0 4px 18px rgba(233,69,96,.3)}
    .btn-primary:hover{filter:brightness(1.08)}
    .btn-google{background:#fff;color:#1f1f1f;box-shadow:0 4px 18px rgba(0,0,0,.25)}
    .btn-google:hover{filter:brightness(.96)}
    .btn-ghost{background:var(--surface);color:var(--text-dim);border:1px solid var(--border)}
    .btn-ghost:hover{color:var(--text);border-color:rgba(233,69,96,.35)}
    .btn-danger{background:rgba(239,68,68,.12);color:#fca5a5;border:1px solid rgba(239,68,68,.25)}
    .btn-danger:hover{background:rgba(239,68,68,.85);color:#fff}
    .btn-sm{padding:.42rem .8rem;font-size:.76rem;border-radius:8px}
    .btn:disabled{opacity:.6;cursor:default}
    .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

    label{display:block;font-size:.78rem;color:var(--text-dim);margin-bottom:.35rem;font-weight:600}
    input,select,textarea{width:100%;padding:.62rem .8rem;background:var(--input-bg);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:.86rem;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s}
    select option{background:var(--bg);color:var(--text)}
    input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(233,69,96,.15)}
    input::placeholder,textarea::placeholder{color:var(--text-mute)}

    .alert{display:flex;align-items:center;gap:.6rem;border-radius:10px;padding:.65rem 1rem;margin-bottom:.8rem;font-size:.82rem}
    .alert svg{flex:none}
    .alert-err{background:var(--danger-soft);border:1px solid rgba(233,69,96,.25);color:#fca5a5}
    .alert-ok{background:var(--success-soft);border:1px solid rgba(52,211,153,.22);color:#86efac}

    .card{background:var(--card);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:22px}
    .card-head{display:flex;align-items:center;gap:11px;margin-bottom:16px}
    .card-icon{width:30px;height:30px;border-radius:8px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;flex:none}
    .card-title{font-size:.98rem;font-weight:750;color:var(--text)}
    .card-note{font-size:.76rem;color:var(--text-mute);margin-top:1px}

    /* reply-mode selector */
    .mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:4px}
    .mode-card{position:relative;display:block;border:1px solid var(--border);border-radius:var(--radius-md);padding:15px;cursor:pointer;background:var(--surface);transition:border-color .15s,background .15s}
    .mode-card:hover{border-color:rgba(233,69,96,.3)}
    .mode-card input{position:absolute;opacity:0;pointer-events:none}
    .mode-card.active{border-color:var(--accent);background:var(--accent-soft)}
    .mode-icon{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.06);color:var(--text-dim);display:grid;place-items:center;margin-bottom:10px}
    .mode-card.active .mode-icon{background:var(--accent);color:#fff}
    .mode-title{font-size:.86rem;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px}
    .mode-check{color:var(--accent);display:none}
    .mode-card.active .mode-check{display:inline-flex}
    .mode-desc{font-size:.72rem;color:var(--text-mute);margin-top:4px;line-height:1.4}

    .sep{height:1px;background:var(--border-soft);margin:16px 0}
    .thread-add-form{display:flex;gap:8px;margin-bottom:12px}
    .thread-add-form input{flex:1}
    .thread-list{display:flex;flex-direction:column;gap:8px}
    .thread-item{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:9px 12px}
    .thread-id{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8rem;color:var(--mono-accent)}
    .icon-btn{background:var(--surface);border:1px solid var(--border);color:var(--text-dim);border-radius:7px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;flex:none}
    .icon-btn:hover{color:#fca5a5;border-color:rgba(239,68,68,.35)}
    .empty-hint{font-size:.78rem;color:var(--text-mute);padding:6px 2px}

    .gemini-connected-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
    .gemini-status{display:flex;align-items:center;gap:7px;font-size:.8rem;font-weight:650;color:#4ade80}
    .field-hint{font-size:.72rem;color:var(--text-mute);margin:-4px 0 12px}

    .messages{min-height:200px;max-height:46vh;overflow-y:auto;margin-bottom:12px;padding:10px;background:var(--chat-bg);border-radius:10px;border:1px solid var(--border-soft);display:flex;flex-direction:column;gap:9px}
    .msg{padding:9px 13px;border-radius:12px;white-space:pre-wrap;font-size:.86rem;line-height:1.45;max-width:82%}
    .msg.bot{background:var(--bot-msg);color:var(--bot-msg-text);align-self:flex-start;border-bottom-left-radius:3px}
    .msg.me{background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#fff;align-self:flex-end;border-bottom-right-radius:3px}
    .chat-form{display:flex;gap:8px;align-items:flex-end}
    .chat-form textarea{resize:vertical;min-height:44px}

    .panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
    .span-all{grid-column:1/-1}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    details > summary{cursor:pointer;list-style:none}
    details > summary::-webkit-details-marker{display:none}
    .summary-row{display:flex;align-items:center;gap:8px;color:#a5adf7;font-size:.83rem;font-weight:650;padding:.4rem 0}
    .hint{font-size:.7rem;color:var(--text-mute);margin-top:-.75rem;margin-bottom:1rem}

    @media(max-width:1080px){
      .layout-grid{grid-template-columns:1fr}
      .sidebar-col{position:static;top:auto}
    }
    @media(max-width:520px){
      .mode-grid{grid-template-columns:1fr}
      .form-grid{grid-template-columns:1fr}
      .card{padding:16px}
      .page-wrap{padding:22px 14px 50px}
    }
  `;
}

// Applied before first paint so the saved theme never flashes the wrong colors.
const THEME_BOOT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem("wm_theme")}catch(e){}if(!t)t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)})();`;

const THEME_RUNTIME_SCRIPT = `
function wmApplyTheme(t){
  document.documentElement.setAttribute("data-theme",t);
  try{localStorage.setItem("wm_theme",t)}catch(e){}
  var b=document.getElementById("themeToggle");
  if(b){
    b.innerHTML = t === "light" 
      ? '<svg viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>';
    b.setAttribute("aria-label",t==="light"?"Chuyển sang nền tối":"Chuyển sang nền sáng");
  }
}
function wmToggleTheme(){wmApplyTheme(document.documentElement.getAttribute("data-theme")==="light"?"dark":"light")}
wmApplyTheme(document.documentElement.getAttribute("data-theme")||"dark");
`;

const themeButton = () =>
  `<button type="button" id="themeToggle" class="theme-btn" onclick="wmToggleTheme()" title="Đổi nền sáng / tối"><svg viewBox="0 0 24 24"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg></button>`;

function page(title: string, body: string, opts: { loginPage?: boolean } = {}) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><script>${THEME_BOOT_SCRIPT}</script><style>${css()}</style></head><body class="${opts.loginPage ? "login-body" : ""}"><main class="${opts.loginPage ? "" : "page-wrap"}">${body}</main><script>${THEME_RUNTIME_SCRIPT}</script></body></html>`;
}

async function current(req: Request, id: string) {
  const u = await getSessionUser((req as any).cookies?.userSession);
  return u?.id === id ? u : undefined;
}

function replyModeCard(id: string, user: ServiceUser) {
  const threadList = user.threadIds.length === 0
    ? `<p class="empty-hint">Chưa có hội thoại nào — thêm Thread ID ở trên.</p>`
    : `<div class="thread-list">${user.threadIds.map(tid => `
        <div class="thread-item">
          <span class="thread-id">${icon("facebook", 13)} ${esc(tid)}</span>
          <form method="post" action="/u/${id}/threads/remove" style="margin:0">
            <input type="hidden" name="threadId" value="${esc(tid)}">
            <button type="submit" class="icon-btn" title="Xóa">${icon("trash", 14)}</button>
          </form>
        </div>`).join("")}</div>`;

  return `<section class="card">
    <div class="card-head"><div class="card-icon">${icon("sliders", 15)}</div><div><div class="card-title">Cấu hình trả lời tự động</div><div class="card-note">Chọn cách bot tự động trả lời tin nhắn Messenger cho tài khoản của bạn.</div></div></div>
    <form method="post" action="/u/${id}/reply-mode" class="mode-grid">
      <label class="mode-card ${user.replyMode === "all" ? "active" : ""}">
        <input type="radio" name="mode" value="all" ${user.replyMode === "all" ? "checked" : ""} onchange="this.form.requestSubmit()">
        <div class="mode-icon">${icon("bolt", 16)}</div>
        <div class="mode-title">Trả lời tất cả ${icon("check", 13)}</div>
        <div class="mode-desc">Tự động trả lời mọi hội thoại Messenger gửi đến.</div>
      </label>
      <label class="mode-card ${user.replyMode === "specific" ? "active" : ""}">
        <input type="radio" name="mode" value="specific" ${user.replyMode === "specific" ? "checked" : ""} onchange="this.form.requestSubmit()">
        <div class="mode-icon">${icon("target", 16)}</div>
        <div class="mode-title">Hội thoại cụ thể ${icon("check", 13)}</div>
        <div class="mode-desc">Chỉ trả lời những cuộc trò chuyện bạn thêm bên dưới.</div>
      </label>
    </form>
    ${user.replyMode === "specific" ? `
      <div class="sep"></div>
      <label>Danh sách hội thoại (Thread ID)</label>
      <form method="post" action="/u/${id}/threads/add" class="thread-add-form">
        <input name="threadId" placeholder="Ví dụ: 1234567890" pattern="\\d{5,32}" required title="Lấy từ URL facebook.com/messages/t/[ID]">
        <button type="submit" class="btn btn-primary btn-sm">${icon("plus", 14)} Thêm</button>
      </form>
      ${threadList}
    ` : ""}
  </section>`;
}

function promptCard(id: string, user: ServiceUser, saved: boolean) {
  return `<section class="card">
    <div class="card-head"><div class="card-icon">${icon("edit", 15)}</div><div><div class="card-title">Hướng dẫn AI (system prompt)</div><div class="card-note">Tùy chỉnh tính cách, quy tắc trả lời riêng cho AI của bạn. Để trống để dùng mặc định của hệ thống.</div></div></div>
    ${saved ? `<div class="alert alert-ok">${icon("check")}<span>Đã lưu hướng dẫn AI.</span></div>` : ""}
    <form method="post" action="/u/${id}/system-prompt">
      <textarea name="systemPrompt" rows="5" maxlength="4000" placeholder="Ví dụ: Bạn là nhân viên tư vấn của cửa hàng ABC, luôn trả lời thân thiện, ngắn gọn, ưu tiên giới thiệu sản phẩm đang khuyến mãi...">${esc(user.systemPrompt)}</textarea>
      <button type="submit" class="btn btn-primary" style="width:100%;margin-top:10px">${icon("check")} Lưu hướng dẫn</button>
    </form>
  </section>`;
}

const FB_BOT_STATUS_LABEL: Record<string, string> = {
  stopped: "Chưa kết nối",
  connecting: "Đang kết nối...",
  running: "Đang chạy",
  waiting_2fa: "Cần mã 2FA",
  error: "Lỗi",
};

function fbBotCard(id: string, state: { status: string; error: string | null; messagesHandled: number } | undefined) {
  const status = state?.status ?? "stopped";
  const badgeClass = status === "running" ? "badge-ok" : status === "waiting_2fa" || status === "error" ? "badge-exp" : "badge-used";
  const isRunning = status === "running" || status === "connecting";
  const isWaiting2FA = status === "waiting_2fa";

  return `<section class="card">
    <div class="card-head"><div class="card-icon">${icon("facebook", 15)}</div><div><div class="card-title">Kết nối Facebook riêng <span style="font-size:.68rem;color:var(--text-mute);font-weight:600">(Beta)</span></div><div class="card-note">Dùng tài khoản Facebook của riêng bạn để bot tự trả lời tin nhắn gửi đến đúng inbox của bạn.</div></div></div>
    <div class="alert" style="background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.3);color:#fdba74">${icon("alert")}<span><strong>Lưu ý rủi ro:</strong> tự động hóa tài khoản Facebook cá nhân có thể khiến Facebook khóa/hạn chế tài khoản đó. Khuyến nghị dùng một tài khoản Facebook phụ/kinh doanh, không dùng tài khoản chính của bạn.</span></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <span class="badge ${badgeClass}">${FB_BOT_STATUS_LABEL[status] ?? status}</span>
      ${status === "running" ? `<span style="font-size:.76rem;color:var(--text-mute)">${state?.messagesHandled ?? 0} tin nhắn đã xử lý</span>` : ""}
    </div>
    ${state?.error ? `<div class="alert alert-err">${icon("alert")}<span>${esc(state.error)}</span></div>` : ""}
    ${isWaiting2FA ? `
      <form method="post" action="/u/${id}/fb-bot/2fa">
        <label>Mã xác minh 2FA</label>
        <input name="code" inputmode="numeric" placeholder="Nhập mã 6 số..." required style="margin-bottom:12px">
        <button type="submit" class="btn btn-primary" style="width:100%">${icon("check")} Xác nhận mã 2FA</button>
      </form>
    ` : isRunning ? `
      <form method="post" action="/u/${id}/fb-bot/stop">
        <button type="submit" class="btn btn-danger" style="width:100%">${icon("trash")} Dừng bot</button>
      </form>
    ` : `
      <details style="margin-bottom:14px">
        <summary><div class="summary-row">${icon("edit", 14)} Cách lấy cookie Facebook (1 phút)</div></summary>
        <div class="panel" style="margin-top:10px;font-size:.8rem;line-height:1.7;color:var(--text-dim)">
          1. Cài tiện ích miễn phí <strong style="color:var(--text)">"Cookie-Editor"</strong> cho Chrome/Edge/Firefox (tìm trên cửa hàng tiện ích của trình duyệt).<br>
          2. Đăng nhập Facebook bằng tài khoản bạn muốn dùng cho bot (nên dùng tài khoản phụ, xem lưu ý rủi ro ở trên).<br>
          3. Ở tab facebook.com, bấm icon Cookie-Editor trên thanh công cụ &rarr; chọn <strong style="color:var(--text)">Export</strong> &rarr; <strong style="color:var(--text)">Export as JSON</strong> (nội dung được tự copy vào clipboard).<br>
          4. Dán toàn bộ nội dung vừa copy vào ô bên dưới rồi bấm "Kết nối Facebook".
        </div>
      </details>
      ${hasTenantSavedSession(id) ? `<div class="alert" style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:#86efac;margin-bottom:14px">${icon("check")}<span>Đã có phiên đăng nhập được lưu — để trống ô cookie bên dưới rồi bấm "Kết nối Facebook" để dùng lại, không cần dán cookie mới. Chỉ dán lại khi báo lỗi.</span></div>` : ""}
      <form method="post" action="/u/${id}/fb-bot/start">
        <label>Cookie Facebook${hasTenantSavedSession(id) ? " (để trống để dùng lại phiên đã lưu)" : " (khuyến nghị)"}</label>
        <textarea name="cookies" rows="3" placeholder="Dán JSON từ Cookie-Editor, hoặc chuỗi c_user=...; xs=...; datr=..." style="margin-bottom:6px"></textarea>
        <div style="font-size:.72rem;color:var(--text-mute);margin-bottom:12px">Hoặc đăng nhập bằng email/mật khẩu bên dưới (có thể cần xác minh 2FA)</div>
        <div class="mode-grid">
          <div><label>Email/SĐT</label><input name="email" placeholder="email@vidu.com" style="margin-bottom:0"></div>
          <div><label>Mật khẩu</label><input name="password" type="password" placeholder="Mật khẩu Facebook" style="margin-bottom:0"></div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:14px">${icon("facebook", 15)} Kết nối Facebook</button>
      </form>
    `}
  </section>`;
}

router.get("/u/:id", async (req: Request, res: Response): Promise<void> => {
  const id = (req.params.id as string).toLowerCase();
  const user = await getServiceUser(id);
  if (!validId.test(id) || !user) { res.status(404).send("Không tìm thấy trang."); return; }

  if (!(await current(req, id))) {
    const err = req.query["err"] ? `<div class="alert alert-err">${icon("alert")}<span>Mật khẩu không đúng.</span></div>` : "";
    res.send(page("Đăng nhập", `
      <div class="login-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div class="login-mark">${icon("shield", 22)}</div>
          ${themeButton()}
        </div>
        <h1>${esc(user.name)}</h1>
        <p class="sub">Đăng nhập để quản lý và chọn model Gemini của bạn.</p>
        ${err}
        <form method="post" action="/u/${id}/login">
          <label>Mật khẩu</label>
          <input type="password" name="password" minlength="8" required autofocus placeholder="Nhập mật khẩu..." style="margin-bottom:14px">
          <button style="width:100%" class="btn btn-primary">${icon("unlock")} Đăng nhập</button>
        </form>
      </div>
    `, { loginPage: true }));
    return;
  }

  const c = await getUserAiConfig(user.id);
  const geminiOk = req.query["geminiOk"] ? `<div class="alert alert-ok">${icon("check")}<span>Đã kết nối tài khoản Google thành công! Hãy chọn model Gemini bên dưới.</span></div>` : "";
  const modelSaved = req.query["modelSaved"] ? `<div class="alert alert-ok">${icon("check")}<span>Đã cập nhật model Gemini thành công! Bot Facebook sẽ trả lời bằng model này.</span></div>` : "";
  const modelErr = req.query["modelErr"] ? `<div class="alert alert-err">${icon("alert")}<span>Không lưu được model. Vui lòng kiểm tra lại.</span></div>` : "";
  const threadErr = req.query["threadErr"] ? `<div class="alert alert-err">${icon("alert")}<span>${esc(decodeURIComponent(String(req.query["threadErr"])))}</span></div>` : "";
  const fbBotErr = req.query["fbBotErr"] ? `<div class="alert alert-err">${icon("alert")}<span>${esc(decodeURIComponent(String(req.query["fbBotErr"])))}</span></div>` : "";

  let aiBlock = "";
  const isCustomProvider = !!(c && c.baseUrl);
  const isGeminiOAuth = !!(c && c.accessToken && !c.baseUrl);
  const configSaved = req.query["configSaved"] ? `<div class="alert alert-ok">${icon("check")}<span>Đã lưu cấu hình AI thành công!</span></div>` : "";
  const configErr = req.query["configErr"] ? `<div class="alert alert-err">${icon("alert")}<span>${esc(decodeURIComponent(String(req.query["configErr"])))}</span></div>` : "";
  const configDeleted = req.query["configDeleted"] ? `<div class="alert alert-ok">${icon("check")}<span>Đã xóa cấu hình AI. Bạn có thể thêm tài khoản mới.</span></div>` : "";

  let currentConfigBlock = "";
  if (isCustomProvider && c) {
    currentConfigBlock = `<div class="panel" style="margin-bottom:16px;border-color:rgba(139,92,246,.3)">
      <div class="gemini-connected-head">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="gemini-status" style="color:#a78bfa">${icon("cpu", 13)} ${esc(c.providerLabel || "Custom API")}</div>
          <span class="badge badge-ok">Đang hoạt động</span>
        </div>
        <form method="post" action="/u/${id}/ai-config/delete" style="margin:0">
          <button class="btn btn-danger btn-sm">${icon("trash", 13)} Xóa</button>
        </form>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <div><span style="font-size:.72rem;color:var(--text-mute)">Base URL</span><div class="mono" style="font-size:.78rem;color:var(--mono-accent);word-break:break-all">${esc(c.baseUrl!)}</div></div>
        <div><span style="font-size:.72rem;color:var(--text-mute)">Model</span><div style="font-size:.85rem;font-weight:650;color:var(--text)">${esc(c.model)}</div></div>
      </div>
      <form method="post" action="/u/${id}/model" style="margin-top:12px;display:flex;gap:8px;align-items:end">
        <div style="flex:1"><label style="font-size:.72rem">Đổi model</label><input name="customModel" value="${esc(c.model)}" required placeholder="Dán tên model bất kỳ..."></div>
        <button type="submit" class="btn btn-primary btn-sm">${icon("check", 13)} Lưu</button>
      </form>
    </div>`;
  } else if (isGeminiOAuth && c) {
    const models = await fetchGeminiModels(c.accessToken);
    if (!models.includes(c.model)) models.unshift(c.model);
    const opts = models.map(m => `<option value="${esc(m)}" ${m === c.model ? "selected" : ""}>${esc(m)}${m === c.model ? " (đang dùng)" : ""}</option>`).join("");

    currentConfigBlock = `<div class="panel" style="margin-bottom:16px;border-color:rgba(52,211,153,.3)">
      <div class="gemini-connected-head">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="gemini-status">${icon("check", 13)} Gemini (Google OAuth)</div>
          <span class="badge badge-ok">Đang hoạt động</span>
        </div>
        <div style="display:flex;gap:6px">
          <a class="btn btn-ghost btn-sm" href="/u/${id}/gemini">${icon("rotate", 13)} Đổi Google</a>
          <form method="post" action="/u/${id}/ai-config/delete" style="margin:0">
            <button class="btn btn-danger btn-sm">${icon("trash", 13)} Xóa</button>
          </form>
        </div>
      </div>
      <form method="post" action="/u/${id}/model" style="margin-top:12px">
        <label>Chọn Model Gemini</label>
        <select name="model" required style="margin-bottom:8px">${opts}</select>
        <label style="font-size:.72rem">Hoặc tự dán tên model bất kỳ</label>
        <input name="customModel" list="gemini-model-list" placeholder="Ví dụ: gemini-3-pro-preview" style="margin-bottom:6px">
        <datalist id="gemini-model-list">${models.map(m => `<option value="${esc(m)}"></option>`).join("")}</datalist>
        <div class="field-hint">Ô này ưu tiên hơn danh sách ở trên. Dùng khi Google vừa ra model mới chưa có sẵn trong danh sách.</div>
        <button type="submit" class="btn btn-primary" style="width:100%">${icon("check")} Lưu Model</button>
      </form>
    </div>`;
  }

  const hasConfig = !!(c && c.accessToken);
  aiBlock = `<section class="card">
    <div class="card-head"><div class="card-icon">${icon("sparkles", 15)}</div><div><div class="card-title">Tài khoản AI</div><div class="card-note">Thêm Google Gemini (OAuth) hoặc nhập API key thủ công (ChatGPT, OpenRouter, Claude, 9Router...)</div></div></div>
    ${configSaved}${configErr}${configDeleted}
    ${currentConfigBlock}
    ${hasConfig ? `<details style="margin-top:8px"><summary><div class="summary-row">${icon("plus", 14)} Thay đổi sang tài khoản AI khác</div></summary>` : ""}
    <div class="panel" style="margin-top:${hasConfig ? "10px" : "14px"}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <a class="btn btn-google" href="/u/${id}/gemini" style="text-align:center">${icon("key", 15)} Google Gemini (OAuth)</a>
        <button type="button" class="btn btn-ghost" style="border:1px solid var(--border)" onclick="document.getElementById('custom-form').style.display=document.getElementById('custom-form').style.display==='none'?'block':'none'">${icon("cpu", 15)} Nhập API Key thủ công</button>
      </div>
      <div id="custom-form" style="display:${hasConfig ? "none" : "block"}">
        <form method="post" action="/u/${id}/ai-config" class="form-grid" style="grid-template-columns:1fr 1fr">
          <div><label>Tên provider</label><input name="providerLabel" placeholder="ChatGPT / OpenRouter / Claude..." required></div>
          <div><label>Base URL (OpenAI-compatible)</label><input name="baseUrl" placeholder="https://api.openai.com/v1" required><div class="hint">Endpoint tương thích OpenAI Chat Completions</div></div>
          <div><label>API Key</label><input name="apiKey" type="password" placeholder="sk-..." required></div>
          <div><label>Model</label><input name="model" placeholder="gpt-4o-mini / claude-sonnet-4-6 / ..." required></div>
          <div class="span-all"><button type="submit" class="btn btn-primary" style="width:100%">${icon("plus")} Thêm tài khoản AI</button></div>
        </form>
      </div>
    </div>
    ${hasConfig ? "</details>" : ""}
  </section>`;

  res.send(page(user.name, `
    <header class="user-header">
      <div class="user-id">
        <div class="avatar">${initialOf(user.name)}</div>
        <div>
          <div class="uh-name">${esc(user.name)}</div>
          <div class="uh-sub" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="badge ${user.replyMode === "all" ? "badge-ok" : "badge-used"}">${user.replyMode === "all" ? "Tất cả hội thoại" : `${user.threadIds.length} hội thoại cụ thể`}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;color:var(--text-mute)">${icon("facebook", 12)} ${esc(user.id)}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        ${themeButton()}
        <form method="post" action="/u/${id}/logout" style="margin:0"><button class="btn btn-ghost">${icon("logout")} Đăng xuất</button></form>
      </div>
    </header>
    ${geminiOk}${modelSaved}${modelErr}${threadErr}${fbBotErr}
    <div class="layout-grid">
      <div class="col-stack">
        ${replyModeCard(id, user)}
        ${promptCard(id, user, !!req.query["promptSaved"])}
        ${fbBotCard(id, getTenantBotState(user.id))}
      </div>
      <div class="col-stack sidebar-col">
        ${aiBlock}
        <section class="card">
          <div class="card-head"><div class="card-icon">${icon("message", 15)}</div><div><div class="card-title">Test Chat trực tiếp</div><div class="card-note">Thử ngay để xem AI sẽ trả lời như thế nào.</div></div></div>
          <div id="messages" class="messages"><div class="msg bot">🤖 Sẵn sàng test với model Gemini của bạn.</div></div>
          <form id="chat" class="chat-form">
            <textarea id="prompt" required placeholder="Nhập tin nhắn test..." rows="1"></textarea>
            <button id="sbtn" type="submit" class="btn btn-primary icon-btn" style="width:44px;height:44px;border-radius:9px">${icon("send", 16)}</button>
          </form>
        </section>
      </div>
    </div>
    <script>
      const m = document.querySelector("#messages"), f = document.querySelector("#chat"), p = document.querySelector("#prompt"), btn = document.querySelector("#sbtn");
      const escHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = p.value.trim();
        if (!v) return;
        m.innerHTML += '<div class="msg me">' + escHtml(v) + '</div>';
        p.value = '';
        m.scrollTop = m.scrollHeight;
        btn.disabled = true;
        try {
          const res = await fetch('/u/${id}/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ prompt: v }) });
          const d = await res.json();
          m.innerHTML += '<div class="msg bot">' + escHtml(d.reply || d.error || 'Không có phản hồi') + '</div>';
        } catch (err) {
          m.innerHTML += '<div class="msg bot" style="color:#fca5a5">Lỗi: ' + escHtml(err.message) + '</div>';
        } finally {
          btn.disabled = false;
          m.scrollTop = m.scrollHeight;
        }
      };
    </script>
  `));
});
router.post("/u/:id/login", async (req,res) => { const id=req.params.id.toLowerCase(); const u=await authenticateServiceUser(id,String(req.body.password??"")); if(!u)return res.redirect(`/u/${id}?err=1`); res.cookie("userSession",createUserSession(id),{httpOnly:true,sameSite:"lax",secure:req.secure,maxAge:604800000});res.redirect(`/u/${id}`); });
router.post("/u/:id/logout",(req,res)=>{deleteUserSession((req as any).cookies?.userSession);res.clearCookie("userSession");res.redirect(`/u/${req.params.id}`)});
router.get("/u/:id/gemini", async (req, res) => { const u=await current(req,req.params.id.toLowerCase()); if(!u)return res.redirect(`/u/${req.params.id}`); res.redirect("/connect/gemini"); });
router.post("/u/:id/model", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  const rawModel = String(req.body.customModel?.trim() || req.body.model?.trim() || "");
  const cleanModel = rawModel.replace(/^models\//, "").trim();
  if (!u || !validModel.test(cleanModel) || !(await updateUserAiModel(u.id, cleanModel))) {
    res.redirect(`/u/${id}?modelErr=1`);
    return;
  }
  res.redirect(`/u/${id}?modelSaved=1`);
});
router.post("/u/:id/reply-mode", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (u) await setServiceUserReplyMode(id, req.body.mode === "all" ? "all" : "specific");
  res.redirect(`/u/${id}`);
});
router.post("/u/:id/system-prompt", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (u) await setServiceUserSystemPrompt(id, String(req.body.systemPrompt ?? ""));
  res.redirect(`/u/${id}?promptSaved=1`);
});
router.post("/u/:id/threads/add", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (!u) { res.redirect(`/u/${id}`); return; }
  const result = await addServiceUserThread(id, String(req.body.threadId ?? ""));
  res.redirect(result.ok ? `/u/${id}` : `/u/${id}?threadErr=${encodeURIComponent(result.error ?? "Lỗi không xác định.")}`);
});
router.post("/u/:id/threads/remove", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (u) await removeServiceUserThread(id, String(req.body.threadId ?? ""));
  res.redirect(`/u/${id}`);
});
router.post("/u/:id/chat", async (req, res): Promise<void> => {
  const u = await current(req, req.params.id.toLowerCase());
  const prompt = String(req.body.prompt ?? "").trim();
  if (!u) { res.status(401).json({ error: "Cần đăng nhập." }); return; }
  if (!prompt) { res.status(400).json({ error: "Thiếu tin nhắn." }); return; }
  try {
    res.json({ reply: await getClaudeReply(u.id, prompt, u.systemPrompt || botState.systemPrompt, u.id) });
  } catch (err: any) {
    const detail = String(err?.message ?? "").trim();
    res.status(502).json({ error: detail ? `AI lỗi: ${detail}` : "AI chưa sẵn sàng. Hãy kết nối Gemini hoặc liên hệ admin." });
  }
});

// ── Custom AI config (manual API key) ─────────────────────────────────────────
router.post("/u/:id/ai-config", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (!u) { res.redirect(`/u/${id}`); return; }
  const { providerLabel, baseUrl, apiKey, model } = req.body as {
    providerLabel?: string; baseUrl?: string; apiKey?: string; model?: string;
  };
  if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
    res.redirect(`/u/${id}?configErr=${encodeURIComponent("Vui lòng nhập đầy đủ Base URL, API Key và Model.")}`);
    return;
  }
  await setUserAiConfig({
    ownerKey: u.id,
    accessToken: apiKey.trim(),
    tokenExpiry: 0,
    model: model.trim(),
    baseUrl: baseUrl.trim(),
    providerLabel: (providerLabel ?? "Custom").trim().slice(0, 60),
    connectedAt: Date.now(),
  });
  res.redirect(`/u/${id}?configSaved=1`);
});

router.post("/u/:id/ai-config/delete", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (u) await deleteUserAiConfig(u.id);
  res.redirect(`/u/${id}?configDeleted=1`);
});

// ── Per-customer Facebook bot (Beta) ──────────────────────────────────────────
router.post("/u/:id/fb-bot/start", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (!u) { res.redirect(`/u/${id}`); return; }

  const { cookies, email, password } = req.body as { cookies?: string; email?: string; password?: string };
  let credentials: LoginCredentials;

  if (cookies?.trim()) {
    const { parsed, error } = parseAppState(cookies);
    if (error) { res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent(error)}`); return; }
    const cookieErr = validateRequiredCookies(parsed);
    if (cookieErr) { res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent(cookieErr)}`); return; }
    credentials = { type: "appstate", appState: parsed };
  } else if (email?.trim() && password?.trim()) {
    credentials = { type: "credentials", email: email.trim(), password };
  } else if (hasTenantSavedSession(id)) {
    // Cookie box left blank on purpose — reuse the previously saved session
    // instead of asking the customer to paste their cookie again.
    credentials = { type: "appstate", appState: [] };
  } else {
    res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent("Chưa có phiên nào được lưu trước đó. Vui lòng dán cookie Facebook hoặc nhập email/mật khẩu.")}`);
    return;
  }

  try {
    await startTenantBot(id, credentials);
  } catch (err: any) {
    if (!(err instanceof TwoFactorRequired || err?.name === "TwoFactorRequired")) {
      res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent(err?.message ?? "Kết nối Facebook thất bại.")}`);
      return;
    }
    // 2FA required — state already reflects "waiting_2fa", just re-render.
  }
  res.redirect(`/u/${id}`);
});

router.post("/u/:id/fb-bot/2fa", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (!u) { res.redirect(`/u/${id}`); return; }
  const { code } = req.body as { code?: string };
  if (!code?.trim()) { res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent("Vui lòng nhập mã 2FA.")}`); return; }
  try {
    await submitTenantBot2FA(id, code.trim());
  } catch (err: any) {
    res.redirect(`/u/${id}?fbBotErr=${encodeURIComponent(err?.message ?? "Xác minh 2FA thất bại.")}`);
    return;
  }
  res.redirect(`/u/${id}`);
});

router.post("/u/:id/fb-bot/stop", async (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = await current(req, id);
  if (u) stopTenantBot(id);
  res.redirect(`/u/${id}`);
});

export default router;
