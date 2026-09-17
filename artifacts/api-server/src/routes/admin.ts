import { Router, type IRouter, type Request, type Response } from "express";
import {
  ADMIN_TOKEN,
  requireAdmin,
  createUserToken,
  listUserTokens,
  deleteUserToken,
  createAiAccount,
  listAiAccounts,
  deleteAiAccount,
  createServiceUser,
  addServiceUserThread,
  listServiceUsers,
  deleteServiceUser,
  setServiceUserActive,
  listUserAiConfigs,
} from "../lib/adminAuth";
import { botState } from "../bot/state";
import { resolveProfileIdViaBot } from "../bot/facebook";
import { icon } from "../lib/icons";
import { resolveFacebookId } from "../lib/facebookId";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════

function css() {
  return `
    :root{
      --bg:#0b0b18;--accent:#e94560;--accent-dark:#c23152;--accent-soft:rgba(233,69,96,.13);
      --surface:rgba(255,255,255,.03);--surface-hover:rgba(255,255,255,.055);
      --border:rgba(255,255,255,.08);--border-soft:rgba(255,255,255,.06);
      --card:rgba(18,18,42,.72);--sidebar:rgba(9,9,22,.92);
      --text:#f8fafc;--text-dim:#94a3b8;--text-mute:#64748b;
      --success:#4ade80;--success-soft:rgba(52,211,153,.1);
      --danger:#f87171;--danger-soft:rgba(233,69,96,.1);
      --radius-lg:20px;--radius-md:14px;--radius-sm:10px;
      --font:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
    }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;background-image:radial-gradient(circle at 8% 0%,var(--accent-soft),transparent 30%),radial-gradient(circle at 92% 8%,rgba(56,189,248,.09),transparent 26%);background-attachment:fixed}
    a{color:inherit}

    /* ---------- Login ---------- */
    body.login-body{padding:24px;display:flex;align-items:center;justify-content:center}
    .login-card{background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(233,69,96,.16);border-radius:var(--radius-lg);padding:36px 34px;width:100%;max-width:400px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
    .login-mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--accent-dark));display:grid;place-items:center;color:#fff;box-shadow:0 0 28px rgba(233,69,96,.4);margin-bottom:18px}
    .login-card h1{font-size:1.3rem;font-weight:800;margin-bottom:.3rem}
    .login-card .sub{color:var(--text-dim);font-size:.85rem;margin-bottom:1.5rem}

    /* ---------- Shared form / button / table primitives ---------- */
    h1{font-size:1.4rem;font-weight:700;margin-bottom:.25rem;color:var(--text)}
    label{display:block;font-size:.78rem;color:var(--text-dim);margin-bottom:.35rem;font-weight:600}
    .hint{font-size:.7rem;color:var(--text-mute);margin-top:-.75rem;margin-bottom:1rem}
    input,select{width:100%;padding:.65rem .85rem;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:.88rem;outline:none;margin-bottom:1rem;transition:border-color .15s,box-shadow .15s;font-family:inherit}
    input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(233,69,96,.15)}
    input::placeholder{color:var(--text-mute)}

    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.62rem 1.15rem;border-radius:9px;font-weight:650;font-size:.85rem;cursor:pointer;border:none;transition:all .15s;font-family:inherit;white-space:nowrap}
    .btn svg{flex:none}
    .btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#fff;box-shadow:0 4px 18px rgba(233,69,96,.3)}
    .btn-primary:hover{filter:brightness(1.08);box-shadow:0 6px 26px rgba(233,69,96,.45)}
    .btn-danger{background:rgba(239,68,68,.12);color:#fca5a5;border:1px solid rgba(239,68,68,.25)}
    .btn-danger:hover{background:rgba(239,68,68,.85);color:#fff}
    .btn-ghost{background:var(--surface);color:var(--text-dim);border:1px solid var(--border)}
    .btn-ghost:hover{color:var(--text);border-color:rgba(233,69,96,.35);background:var(--surface-hover)}
    .btn-sm{padding:.4rem .75rem;font-size:.74rem;border-radius:7px}
    .btn-icon{padding:.4rem;border-radius:7px}
    .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

    .alert{display:flex;align-items:center;gap:.6rem;border-radius:10px;padding:.7rem 1rem;margin-bottom:.85rem;font-size:.84rem}
    .alert svg{flex:none}
    .alert-err{background:var(--danger-soft);border:1px solid rgba(233,69,96,.25);color:#fca5a5}
    .alert-ok{background:var(--success-soft);border:1px solid rgba(52,211,153,.22);color:#86efac}

    table{width:100%;border-collapse:collapse;font-size:.82rem}
    thead th{position:sticky;top:0;background:rgba(15,15,30,.9);backdrop-filter:blur(6px)}
    th{text-align:left;color:var(--text-mute);font-weight:700;padding:.65rem .85rem;border-bottom:1px solid var(--border-soft);text-transform:uppercase;letter-spacing:.06em;font-size:.68rem}
    td{padding:.7rem .85rem;border-bottom:1px solid var(--border-soft);color:#cbd5e1;vertical-align:middle}
    tbody tr:last-child td{border-bottom:none}
    tbody tr:hover td{background:rgba(233,69,96,.045)}
    .table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);max-height:520px;overflow-y:auto}

    .badge{display:inline-flex;align-items:center;gap:6px;padding:.2rem .6rem .2rem .5rem;border-radius:99px;font-size:.68rem;font-weight:700;letter-spacing:.02em}
    .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
    .badge-ok{background:var(--success-soft);color:#4ade80;border:1px solid rgba(52,211,153,.25)}
    .badge-used{background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid var(--border)}
    .badge-exp{background:var(--danger-soft);color:#f87171;border:1px solid rgba(233,69,96,.25)}

    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .link-row{display:flex;align-items:center;gap:6px}
    .link-box{flex:1;background:rgba(233,69,96,.07);border:1px solid rgba(233,69,96,.18);border-radius:8px;padding:.5rem .75rem;font-size:.74rem;color:#f0a1ae;word-break:break-all}
    .copy-btn{flex:none;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text-dim);border-radius:7px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;transition:all .15s}
    .copy-btn:hover{color:var(--text);border-color:rgba(233,69,96,.35)}
    .copy-btn.copied{color:#4ade80;border-color:rgba(52,211,153,.35)}

    .avatar{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,rgba(233,69,96,.35),rgba(194,49,82,.35));display:grid;place-items:center;font-weight:800;font-size:.85rem;color:#fca5b5;flex:none;border:1px solid rgba(233,69,96,.25)}
    .name-cell{display:flex;align-items:center;gap:11px}
    .empty-row td{color:var(--text-mute);text-align:center;padding:2.2rem 1rem}
    .empty-row .empty-icon{opacity:.5;margin-bottom:8px}

    .sep{height:1px;background:var(--border-soft);margin:1.75rem 0}

    /* ---------- App shell ---------- */
    .admin-shell{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
    .sidebar{background:var(--sidebar);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-right:1px solid var(--border-soft);padding:26px 16px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
    .side-brand{display:flex;align-items:center;gap:12px;margin:2px 8px 30px}
    .side-brand .mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent-dark));display:grid;place-items:center;color:#fff;box-shadow:0 0 20px rgba(233,69,96,.4);flex:none}
    .side-brand .name{font-size:1.02rem;font-weight:800;color:var(--text);line-height:1.15}
    .side-brand .tag{font-size:.62rem;color:var(--accent);letter-spacing:.09em;font-weight:800;margin-top:1px}
    .nav-label{font-size:.65rem;color:var(--text-mute);letter-spacing:.11em;text-transform:uppercase;margin:22px 12px 8px;font-weight:700}
    .nav-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;color:var(--text-dim);text-decoration:none;font-weight:650;font-size:.85rem;margin:2px 0;transition:background .15s,color .15s}
    .nav-item svg{opacity:.8;flex:none}
    .nav-item:hover{background:var(--surface-hover);color:var(--text)}
    .nav-item.active{background:var(--accent-soft);color:var(--accent)}
    .nav-item.active svg{opacity:1}
    .sidebar-foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--border-soft);font-size:.68rem;color:var(--text-mute)}

    .admin-main{padding:34px 42px;max-width:1520px;width:100%}
    .topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:26px;flex-wrap:wrap}
    .page-title{font-size:1.5rem;font-weight:800;color:var(--text)}
    .page-sub{font-size:.83rem;color:var(--text-dim);margin-top:4px}
    .topbar-actions{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}

    .dashboard-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}
    .metric{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px;transition:transform .15s,border-color .15s,box-shadow .15s}
    .metric:hover{transform:translateY(-2px);border-color:rgba(233,69,96,.32);box-shadow:0 14px 34px rgba(233,69,96,.12)}
    .metric-icon{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;margin-bottom:14px;background:rgba(255,255,255,.06);color:var(--text-dim)}
    .metric-icon.accent{background:var(--accent-soft);color:var(--accent)}
    .metric-icon.ok{background:var(--success-soft);color:#4ade80}
    .metric-label{font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
    .metric-value{font-size:1.85rem;font-weight:800;color:var(--text);margin-top:6px;line-height:1}
    .metric-foot{font-size:.72rem;color:var(--text-mute);margin-top:7px}

    .quick-actions{display:flex;gap:.7rem;margin-bottom:24px;flex-wrap:wrap}

    .section{padding:26px 0;border-top:1px solid var(--border-soft);scroll-margin-top:20px}
    .section:first-of-type{border-top:0;padding-top:0}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
    .section-head-left{display:flex;align-items:center;gap:10px}
    .section-icon{width:30px;height:30px;border-radius:8px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;flex:none}
    .section-title{font-size:1.02rem;font-weight:750;color:var(--text)}
    .section-note{font-size:.76rem;color:var(--text-mute);margin-top:1px}

    .panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px}
    .form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
    .span-all{grid-column:1/-1}
    details > summary{cursor:pointer;list-style:none}
    details > summary::-webkit-details-marker{display:none}
    .summary-row{display:flex;align-items:center;gap:8px;color:#a5adf7;font-size:.83rem;font-weight:650;padding:.4rem 0}

    .card{max-width:none;margin:0;background:var(--card);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(233,69,96,.12);border-radius:var(--radius-lg);box-shadow:0 20px 60px rgba(0,0,0,.4);padding:0}

    @media(max-width:980px){
      .admin-shell{grid-template-columns:1fr}
      .sidebar{position:static;height:auto;padding:16px;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px}
      .side-brand{margin:0 10px 0 0}
      .nav-label{display:none}
      .nav-item{padding:8px 11px}
      .sidebar-foot{display:none}
      .admin-main{padding:20px}
      .dashboard-grid{grid-template-columns:repeat(2,1fr)}
      .form-grid{grid-template-columns:repeat(2,1fr)}
    }
    @media(max-width:560px){
      .topbar{flex-direction:column;align-items:stretch}
      .dashboard-grid,.form-grid{grid-template-columns:1fr}
      .admin-main{padding:14px}
    }
  `;
}

function layout(title: string, body: string, opts: { loginPage?: boolean; withScript?: boolean } = {}) {
  const script = opts.withScript ? `
  <script>
    function wmCopy(btn, text){
      navigator.clipboard.writeText(text).then(function(){
        var old = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = '${icon("check", 14)}';
        setTimeout(function(){ btn.innerHTML = old; btn.classList.remove('copied'); }, 1400);
      });
    }
    document.addEventListener('DOMContentLoaded', function () {
      var sections = document.querySelectorAll('main section[id], main div[id="dashboard-top"]');
      var navItems = document.querySelectorAll('.nav-item[data-section]');
      if (sections.length && navItems.length && 'IntersectionObserver' in window) {
        var obs = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              navItems.forEach(function (n) { n.classList.remove('active'); });
              var active = document.querySelector('.nav-item[data-section="' + e.target.id + '"]');
              if (active) active.classList.add('active');
            }
          });
        }, { rootMargin: '-35% 0px -55% 0px' });
        sections.forEach(function (s) { obs.observe(s); });
      }
    });
  </script>` : "";
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — WolfMod Admin</title>
  <style>${css()}</style>
</head><body class="${opts.loginPage ? "login-body" : ""}">${body}${script}</body></html>`;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function tokenStatus(t: { usedAt: number | null; expiresAt: number }) {
  if (t.usedAt) return `<span class="badge badge-used">Đã dùng</span>`;
  if (t.expiresAt < Date.now()) return `<span class="badge badge-exp">Hết hạn</span>`;
  return `<span class="badge badge-ok">Còn hiệu lực</span>`;
}

function initialOf(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

// ═══════════════════════════════════════════════════════
// GET /admin/login
// ═══════════════════════════════════════════════════════
router.get("/admin/login", (req: Request, res: Response) => {
  const err = req.query["err"] ? "Token không đúng." : "";
  const ok = req.query["logout"] ? "Đã đăng xuất." : "";
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.send(layout("Đăng nhập Admin", `
    <div class="login-card">
      <div class="login-mark">${icon("shield", 24)}</div>
      <h1>Admin Login</h1>
      <p class="sub">Nhập Admin Token để truy cập trang quản trị bot.</p>
      ${err ? `<div class="alert alert-err">${icon("alert")}<span>${err}</span></div>` : ""}
      ${ok ? `<div class="alert alert-ok">${icon("check")}<span>${ok}</span></div>` : ""}
      <form method="POST" action="/admin/login">
        <label>Admin Token</label>
        <input type="password" name="token" placeholder="Nhập token..." autofocus autocomplete="current-password" />
        <button type="submit" class="btn btn-primary" style="width:100%">${icon("unlock")} Đăng nhập</button>
      </form>
    </div>
  `, { loginPage: true }));
});

// ═══════════════════════════════════════════════════════
// POST /admin/login
// ═══════════════════════════════════════════════════════
router.post("/admin/login", (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!ADMIN_TOKEN) {
    res.status(503).send("ADMIN_TOKEN chưa được đặt trong env.");
    return;
  }
  if (!token || token !== ADMIN_TOKEN) {
    res.redirect("/admin/login?err=1");
    return;
  }
  res.cookie("adminToken", ADMIN_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 3600 * 1000, // 7 ngay
  });
  res.redirect("/admin");
});

// ═══════════════════════════════════════════════════════
// POST /admin/logout
// ═══════════════════════════════════════════════════════
router.post("/admin/logout", (req: Request, res: Response) => {
  res.clearCookie("adminToken");
  res.redirect("/admin/login?logout=1");
});

// ═══════════════════════════════════════════════════════
// GET /admin  — dashboard
// ═══════════════════════════════════════════════════════
router.get("/admin", requireAdmin, async (req: Request, res: Response) => {
  const [tokens, accounts, serviceUsers, aiConfigs] = await Promise.all([
    listUserTokens(),
    listAiAccounts(),
    listServiceUsers(),
    listUserAiConfigs(),
  ]);
  const connectedOwnerKeys = new Set(aiConfigs.map(c => c.ownerKey));
  const activeUsers = serviceUsers.filter(user => user.active).length;
  const geminiUsers = serviceUsers.filter(user => connectedOwnerKeys.has(user.id)).length;
  const geminiOk = req.query["geminiOk"] as string | undefined;
  const geminiErr = req.query["geminiErr"] as string | undefined;
  const created = req.query["created"] as string | undefined;
  const deleted = req.query["deleted"] as string | undefined;
  const accCreated = req.query["accCreated"] as string | undefined;
  const accDeleted = req.query["accDeleted"] as string | undefined;
  const baseOrigin = `${req.protocol}://${req.get("host")}`;
  const botOn = botState.status === "running";

  const accRows = accounts.length === 0
    ? `<tr class="empty-row"><td colspan="4"><div class="empty-icon">${icon("cpu", 22)}</div>Chưa có tài khoản AI nào. Thêm ở form dưới.</td></tr>`
    : accounts.map(a => `
        <tr>
          <td><div style="font-weight:650;color:#e2e8f0">${a.name}</div></td>
          <td class="mono" style="font-size:.75rem;color:#818cf8;max-width:220px;word-break:break-all">${a.baseUrl}</td>
          <td class="mono" style="font-size:.75rem;color:#64748b">${a.model}</td>
          <td><form method="POST" action="/admin/accounts/delete" style="display:inline"><input type="hidden" name="id" value="${a.id}" /><button class="btn btn-danger btn-sm">${icon("trash", 13)} Xóa</button></form></td>
        </tr>`).join("");

  const accMap = new Map(accounts.map(a => [a.id, a]));
  const tokenRows = tokens.length === 0
    ? `<tr class="empty-row"><td colspan="7"><div class="empty-icon">${icon("link", 22)}</div>Chưa có link nào.</td></tr>`
    : tokens.map(t => {
        const geminiLink = `${baseOrigin}/connect/gemini?userToken=${t.id}`;
        const ttlLeft = Math.max(0, Math.round((t.expiresAt - Date.now()) / 60000));
        const accName = t.aiAccountId ? (accMap.get(t.aiAccountId)?.name ?? `<span style="color:#f87171">?</span>`) : `<span style="color:#64748b">Gemini OAuth</span>`;
        return `<tr>
          <td><div style="font-weight:650;color:#e2e8f0">${t.label}</div><div style="font-size:.7rem;color:#4b5563;margin-top:2px">${fmtDate(t.createdAt)}</div><div style="font-size:.7rem;color:#818cf8">Thread: ${t.fbThreadId || "-"}</div></td>
          <td>${tokenStatus(t)}</td>
          <td style="color:#64748b">${t.usedAt ? fmtDate(t.usedAt) : (t.expiresAt < Date.now() ? "Hết hạn" : `Còn ${ttlLeft} phút`)}</td>
          <td style="color:#94a3b8;font-size:.8rem">${accName}</td>
          <td style="color:#e2e8f0;max-width:140px;word-break:break-all">${t.usedByLabel ? `<span style="color:#4ade80">${t.usedByLabel}</span>` : `<span style="color:#4b5563">-</span>`}</td>
          <td class="mono" style="max-width:270px"><div class="link-row"><div class="link-box">${geminiLink}</div><button type="button" class="copy-btn" title="Sao chép link" onclick="wmCopy(this,'${geminiLink}')">${icon("copy", 14)}</button></div></td>
          <td><form method="POST" action="/admin/links/delete" style="display:inline"><input type="hidden" name="id" value="${t.id}" /><button class="btn btn-danger btn-sm">${icon("trash", 13)} Xóa</button></form></td>
        </tr>`;
      }).join("");

  const serviceUserRows = serviceUsers.length === 0
    ? `<tr class="empty-row"><td colspan="7"><div class="empty-icon">${icon("users", 22)}</div>Chưa có khách hàng nào. Tạo khách hàng đầu tiên ở form bên dưới.</td></tr>`
    : serviceUsers.map(u => {
        const userUrl = `${baseOrigin}/u/${u.id}`;
        const modeBadge = u.replyMode === "all"
          ? `<span class="badge badge-ok">Tất cả hội thoại</span>`
          : `<span class="badge badge-used">${u.threadIds.length} hội thoại cụ thể</span>`;
        const threadPreview = u.replyMode === "specific" && u.threadIds.length > 0
          ? `<div class="mono" style="font-size:.68rem;color:#64748b;margin-top:4px;max-width:170px;word-break:break-all">${u.threadIds.join(", ")}</div>`
          : "";
        return `<tr>
          <td><div class="name-cell"><div class="avatar">${initialOf(u.name)}</div><div><div style="font-weight:700;color:#f1f5f9">${u.name}</div><div class="mono" style="font-size:.7rem;color:#818cf8;margin-top:2px;display:inline-flex;align-items:center;gap:4px">${icon("facebook", 11)} ${u.id}</div></div></div></td>
          <td>${modeBadge}${threadPreview}</td>
          <td style="font-size:.78rem;color:#94a3b8">${fmtDate(u.createdAt)}</td>
          <td>${u.active ? `<span class="badge badge-ok">Hoạt động</span>` : `<span class="badge badge-exp">Đã khóa</span>`}</td>
          <td>${connectedOwnerKeys.has(u.id) ? `<span class="badge badge-ok">Đã kết nối</span>` : `<span class="badge badge-used">Chưa kết nối</span>`}</td>
          <td><div class="link-row" style="max-width:190px"><a href="${userUrl}" target="_blank" rel="noreferrer" class="mono" style="font-size:.74rem;color:#818cf8;display:inline-flex;align-items:center;gap:5px">/u/${u.id} ${icon("external", 12)}</a></div></td>
          <td style="white-space:nowrap">
            <form method="POST" action="/admin/users/toggle" style="display:inline"><input type="hidden" name="id" value="${u.id}"><input type="hidden" name="active" value="${u.active ? "0" : "1"}"><button class="btn btn-ghost btn-sm" title="${u.active ? "Khóa" : "Mở khóa"}">${u.active ? icon("lock", 13) : icon("unlock", 13)} ${u.active ? "Khóa" : "Mở"}</button></form>
            <form method="POST" action="/admin/users/delete" style="display:inline;margin-left:6px"><input type="hidden" name="id" value="${u.id}"><button class="btn btn-danger btn-sm">${icon("trash", 13)} Xóa</button></form>
          </td>
        </tr>`;
      }).join("");

  const accOptions = accounts.length === 0
    ? `<option value="">- Chưa có tài khoản AI -</option>`
    : accounts.map(a => `<option value="${a.id}">${a.name} (${a.model})</option>`).join("");

  const alerts = [
    geminiOk ? `<div class="alert alert-ok">${icon("check")}<span>Đã kết nối Gemini thành công!</span></div>` : "",
    geminiErr ? `<div class="alert alert-err">${icon("alert")}<span>Lỗi kết nối Gemini: ${decodeURIComponent(geminiErr)}</span></div>` : "",
    created ? `<div class="alert alert-ok">${icon("check")}<span>Đã tạo link.</span></div>` : "",
    deleted ? `<div class="alert alert-err">${icon("alert")}<span>Đã xóa link.</span></div>` : "",
    accCreated ? `<div class="alert alert-ok">${icon("check")}<span>Đã thêm tài khoản AI.</span></div>` : "",
    accDeleted ? `<div class="alert alert-err">${icon("alert")}<span>Đã xóa tài khoản AI.</span></div>` : "",
  ].join("");

  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.send(layout("Admin Dashboard", `
    <div class="admin-shell">
      <aside class="sidebar">
        <div class="side-brand"><div class="mark">${icon("shield", 19)}</div><div><div class="name">WolfMod</div><div class="tag">ADMIN PANEL</div></div></div>
        <a class="nav-item active" data-section="dashboard-top" href="/admin#dashboard-top">${icon("grid")} Dashboard</a>
        <a class="nav-item" data-section="customers" href="#customers">${icon("users")} Khách hàng</a>
        <a class="nav-item" data-section="links" href="#links">${icon("link")} Gemini links</a>
        <a class="nav-item" data-section="accounts" href="#accounts">${icon("cpu")} AI Accounts</a>
        <div class="nav-label">Hệ thống</div>
        <a class="nav-item" href="/">${icon("home")} Landing page</a>
        <div class="sidebar-foot">Bot: <b style="color:${botOn ? "#4ade80" : "#f87171"}">${botState.status}</b></div>
      </aside>
      <main class="admin-main">
        <div class="card">
          <div style="padding:28px 28px 0">
            <header class="topbar">
              <div><div class="page-title">WolfMod Admin</div><div class="page-sub">Quản lý khách hàng, kết nối Gemini và Facebook Bot</div></div>
              <div class="topbar-actions">
                <span class="badge ${botOn ? "badge-ok" : "badge-exp"}">${botOn ? "Bot đang chạy" : "Bot: " + botState.status}</span>
                <form method="POST" action="/admin/logout"><button class="btn btn-ghost">${icon("logout")} Đăng xuất</button></form>
              </div>
            </header>

            <div id="dashboard-top" class="dashboard-grid">
              <div class="metric"><div class="metric-icon accent">${icon("users", 16)}</div><div class="metric-label">Tổng khách hàng</div><div class="metric-value">${serviceUsers.length}</div><div class="metric-foot">Link con đã cấp phép</div></div>
              <div class="metric"><div class="metric-icon ok">${icon("bolt", 16)}</div><div class="metric-label">Đang hoạt động</div><div class="metric-value" style="color:#4ade80">${activeUsers}</div><div class="metric-foot">${serviceUsers.length - activeUsers} tài khoản đang khóa</div></div>
              <div class="metric"><div class="metric-icon accent">${icon("link", 16)}</div><div class="metric-label">Đã kết nối Gemini</div><div class="metric-value" style="color:#e94560">${geminiUsers}</div><div class="metric-foot">Trên tổng số khách hàng</div></div>
              <div class="metric"><div class="metric-icon ${botOn ? "ok" : ""}">${icon("cpu", 16)}</div><div class="metric-label">Bot Messenger</div><div class="metric-value" style="font-size:1.15rem;padding-top:6px;text-transform:capitalize">${botState.status}</div><div class="metric-foot">${botState.messagesHandled} tin nhắn đã xử lý</div></div>
            </div>

            <div class="quick-actions">
              <a href="/connect/gemini" class="btn btn-primary">${icon("link")} Kết nối Gemini (Admin)</a>
              <a href="/" class="btn btn-ghost">${icon("home")} Landing page</a>
            </div>

            ${alerts}
          </div>

          <div style="padding:0 28px 28px">
            <section id="customers" class="section">
              <div class="section-head">
                <div class="section-head-left"><div class="section-icon">${icon("users", 15)}</div><div><div class="section-title">Khách hàng dịch vụ</div><div class="section-note">Dán link Facebook của người thuê — hệ thống tự tra ID, tên hiển thị và tạo link truy cập riêng cho họ.</div></div></div>
                <span class="badge badge-ok">${activeUsers} đang hoạt động</span>
              </div>
              <div class="panel" style="margin-bottom:16px">
                <form method="POST" action="/admin/users/create" class="form-grid" style="grid-template-columns:1fr 1fr">
                  <div>
                    <label>${icon("facebook", 12)} Link Facebook người thuê</label>
                    <input name="facebookLink" required placeholder="https://facebook.com/ten-nguoi-dung">
                    <div class="hint">Cần bật bot Messenger để tra ID/tên tự động qua phiên đăng nhập. Nếu bot đang tắt hoặc tra lỗi, dán thẳng ID Facebook (dạng số).</div>
                  </div>
                  <div><label>Mật khẩu</label><input name="password" type="password" required minlength="8" placeholder="Tối thiểu 8 ký tự"></div>
                  <div class="span-all"><button class="btn btn-primary">${icon("plus")} Tạo khách hàng và link con</button></div>
                </form>
              </div>
              <div class="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Chế độ trả lời</th><th>Ngày đăng ký</th><th>Trạng thái</th><th>Gemini</th><th>Trang con</th><th>Thao tác</th></tr></thead><tbody>${serviceUserRows}</tbody></table></div>
            </section>

            <section id="accounts" class="section">
              <div class="section-head">
                <div class="section-head-left"><div class="section-icon">${icon("cpu", 15)}</div><div><div class="section-title">Tài khoản AI</div><div class="section-note">Các provider dùng để trả lời tin nhắn (Claude, Gemini, 9Router, OpenRouter...).</div></div></div>
                <span class="badge badge-used">${accounts.length} tài khoản</span>
              </div>
              <div class="table-wrap"><table><thead><tr><th>Tên</th><th>Base URL</th><th>Model</th><th></th></tr></thead><tbody>${accRows}</tbody></table></div>
              <details style="margin-top:14px">
                <summary><div class="summary-row">${icon("plus", 14)} Thêm tài khoản AI mới</div></summary>
                <div class="panel" style="margin-top:10px">
                  <form method="POST" action="/admin/accounts/create" class="form-grid" style="grid-template-columns:1fr 1fr">
                    <div><label>Tên hiển thị</label><input name="name" placeholder="9Router Production" required /></div>
                    <div><label>Base URL</label><input name="baseUrl" placeholder="https://api.9router.dev/v1" required /></div>
                    <div><label>API Key</label><input name="apiKey" type="password" placeholder="sk-..." required /></div>
                    <div><label>Model</label><input name="model" placeholder="cc/claude-opus-4-5" required /></div>
                    <div class="span-all"><button class="btn btn-primary" style="width:100%">${icon("plus")} Thêm tài khoản AI</button></div>
                  </form>
                </div>
              </details>
            </section>

            <section id="links" class="section">
              <div class="section-head">
                <div class="section-head-left"><div class="section-icon">${icon("link", 15)}</div><div><div class="section-title">Link kết nối Gemini</div><div class="section-note">Tạo link OAuth để người dùng tự chọn model Gemini riêng.</div></div></div>
                <span class="badge badge-used">${tokens.length} link</span>
              </div>
              <div class="panel" style="margin-bottom:16px">
                <form method="POST" action="/admin/links/create" class="form-grid" style="grid-template-columns:1fr 1fr">
                  <div><label>Nhãn (tên người dùng)</label><input name="label" placeholder="Khách hàng A" required /></div>
                  <div>
                    <label>FB Thread ID (ID cuộc trò chuyện)</label>
                    <input name="fbThreadId" placeholder="1234567890" required title="Lấy từ URL facebook.com/messages/t/[ID]" />
                    <div class="hint">Lấy từ URL facebook.com/messages/t/[ID]</div>
                  </div>
                  <div><label>Tài khoản AI (tùy chọn)</label><select name="aiAccountId"><option value="">- Không chọn (dùng Gemini OAuth) -</option>${accOptions}</select></div>
                  <div><label>Hiệu lực</label><select name="ttlHours"><option value="1">1 giờ</option><option value="6">6 giờ</option><option value="24" selected>24 giờ</option><option value="72">3 ngày</option><option value="168">7 ngày</option></select></div>
                  <div class="span-all"><button class="btn btn-primary" style="width:100%">${icon("plus")} Tạo link Gemini</button></div>
                </form>
              </div>
              <div class="table-wrap"><table><thead><tr><th>Nhãn</th><th>Trạng thái</th><th>Hết hạn</th><th>Tài khoản AI</th><th>Người dùng</th><th>Link</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table></div>
            </section>
          </div>
        </div>
      </main>
    </div>
  `, { withScript: true }));
});

router.post("/admin/users/create", requireAdmin, async (req: Request, res: Response) => {
  const { facebookLink, password } = req.body as { facebookLink?: string; password?: string };
  if (!password || password.length < 8) { res.status(400).send("Mật khẩu tối thiểu 8 ký tự."); return; }
  if (!facebookLink?.trim()) { res.status(400).send("Vui lòng nhập link Facebook người thuê."); return; }
  const link = facebookLink.trim();

  let resolvedId: string | undefined;
  let resolvedName: string | undefined;
  let resolveError: string | undefined;

  // Pure numeric ID or profile.php?id=NNNN resolve instantly — no network call needed.
  const trivialId = /^\d{5,20}$/.test(link) ? link : link.match(/[?&]id=(\d{5,20})\b/)?.[1];
  if (trivialId) {
    resolvedId = trivialId;
  } else {
    // Prefer the admin bot's own logged-in session — the one channel that
    // reliably passes Facebook's bot detection — before falling back to
    // the (Cloudflare-flaky) third-party lookup service.
    const viaBot = await resolveProfileIdViaBot(link);
    if (viaBot.id) {
      resolvedId = viaBot.id;
      resolvedName = viaBot.name;
    } else {
      const viaHttp = await resolveFacebookId(link);
      if (viaHttp.ok && viaHttp.id) {
        resolvedId = viaHttp.id;
        resolvedName = viaHttp.name;
      } else {
        resolveError = viaBot.error ?? viaHttp.error;
      }
    }
  }

  if (!resolvedId) { res.status(400).send(resolveError ?? "Không tra cứu được ID Facebook."); return; }

  // Name is best-effort — fall back to a generic name rather than blocking
  // customer creation on it.
  const name = resolvedName || `Khách hàng ${resolvedId}`;

  try {
    await createServiceUser({ id: resolvedId, name, password });
    await addServiceUserThread(resolvedId, resolvedId);
    res.redirect("/admin");
  } catch (err: any) {
    res.status(409).send(err?.message ?? "Không tạo được user.");
  }
});
router.post("/admin/users/toggle", requireAdmin, async (req: Request, res: Response) => { const { id, active } = req.body as { id?: string; active?: string }; if (id) await setServiceUserActive(id, active === "1"); res.redirect("/admin"); });
router.post("/admin/users/delete", requireAdmin, async (req: Request, res: Response) => { const { id } = req.body as { id?: string }; if (id) await deleteServiceUser(id); res.redirect("/admin"); });

router.post("/admin/accounts/create", requireAdmin, async (req: Request, res: Response) => {
  const { name, baseUrl, apiKey, model } = req.body as { name?: string; baseUrl?: string; apiKey?: string; model?: string };
  if (!name || !baseUrl || !apiKey || !model) { res.status(400).send("Thiếu thông tin."); return; }
  await createAiAccount({ name: name.trim().slice(0, 80), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim().slice(0, 100) });
  res.redirect("/admin?accCreated=1");
});

router.post("/admin/accounts/delete", requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (id) await deleteAiAccount(id);
  res.redirect("/admin?accDeleted=1");
});

router.post("/admin/links/create", requireAdmin, async (req: Request, res: Response) => {
  const { label, ttlHours, redirectUrl, aiAccountId, fbThreadId } = req.body as { label?: string; ttlHours?: string; redirectUrl?: string; aiAccountId?: string; fbThreadId?: string };
  if (!fbThreadId?.trim()) { res.status(400).send("Phải nhập FB Thread ID."); return; }
  const safeLabel = (label ?? "User").slice(0, 80);
  const ttl = Math.min(Math.max(Number(ttlHours ?? 24), 1), 720);
  const redirect = (redirectUrl ?? "").trim() || `${req.protocol}://${req.get("host")}/`;
  await createUserToken({ label: safeLabel, aiAccountId: aiAccountId ?? "", fbThreadId: fbThreadId.trim(), ttlHours: ttl, redirectUrl: redirect });
  res.redirect("/admin?created=1");
});

router.post("/admin/links/delete", requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (id) await deleteUserToken(id);
  res.redirect("/admin?deleted=1");
});

export default router;
