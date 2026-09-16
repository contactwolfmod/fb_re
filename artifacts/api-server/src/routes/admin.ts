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
  listServiceUsers,
  deleteServiceUser,
  setServiceUserActive,
  listUserAiConfigs,
} from "../lib/adminAuth";
import { botState } from "../bot/state";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function css() {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#090b12;color:#e2e8f0;min-height:100vh;padding:24px}
    .card{background:#121620;border:1px solid #282f43;border-radius:16px;padding:28px;width:100%;max-width:1440px;margin:auto;box-shadow:0 20px 60px #0007}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:22px;border-bottom:1px solid #282f43;margin-bottom:22px}.brand{display:flex;gap:12px;align-items:center}.brand-mark{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#a855f7);display:grid;place-items:center;font-size:20px}.page-title{font-size:1.45rem;font-weight:750;color:#f8fafc}.page-sub{font-size:.82rem;color:#94a3b8;margin-top:3px}.section{padding:24px 0;border-top:1px solid #282f43}.section:first-of-type{border-top:0;padding-top:0}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.section-title{font-size:1rem;font-weight:700;color:#f8fafc}.section-note{font-size:.78rem;color:#64748b}
    .dashboard-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:26px}.metric{background:linear-gradient(145deg,#171c2a,#11151f);border:1px solid #29324a;border-radius:13px;padding:16px}.metric-label{font-size:.75rem;color:#94a3b8}.metric-value{font-size:1.65rem;font-weight:750;color:#f8fafc;margin-top:7px}.metric-foot{font-size:.72rem;color:#64748b;margin-top:4px}.panel{background:#0d1018;border:1px solid #252d40;border-radius:13px;padding:18px}
    .form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:end}.span-all{grid-column:1/-1}.table-wrap{overflow-x:auto;border:1px solid #252d40;border-radius:12px;background:#0d1018} @media(max-width:900px){body{padding:12px}.card{padding:18px}.dashboard-grid{grid-template-columns:repeat(2,1fr)}.form-grid{grid-template-columns:repeat(2,1fr)}} @media(max-width:560px){.topbar{align-items:flex-start;flex-direction:column}.dashboard-grid,.form-grid{grid-template-columns:1fr}.card{padding:14px}}

    h1{font-size:1.4rem;font-weight:700;margin-bottom:.25rem;color:#f1f5f9}
    .sub{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
    label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.35rem;font-weight:500}
    input,select{width:100%;padding:.6rem .85rem;background:#252836;border:1px solid #3a3f5c;border-radius:8px;color:#e2e8f0;font-size:.9rem;outline:none;margin-bottom:1rem}
    input:focus,select:focus{border-color:#6366f1}
    .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.65rem 1.25rem;border-radius:8px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:opacity .15s}
    .btn-primary{background:#6366f1;color:#fff}.btn-primary:hover{opacity:.85}
    .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{opacity:.85}
    .btn-ghost{background:#252836;color:#94a3b8;border:1px solid #3a3f5c}.btn-ghost:hover{color:#e2e8f0}
    .alert-err{background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem}
    .alert-ok{background:#052e16;border:1px solid #14532d;color:#86efac;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem}
    table{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:1rem}
    th{text-align:left;color:#64748b;font-weight:600;padding:.5rem .75rem;border-bottom:1px solid #252836}
    td{padding:.6rem .75rem;border-bottom:1px solid #1a1d27;color:#cbd5e1;vertical-align:top}
    tr:hover td{background:#1e2130}
    .badge{display:inline-block;padding:.15rem .55rem;border-radius:99px;font-size:.7rem;font-weight:600}
    .badge-ok{background:#052e16;color:#4ade80;border:1px solid #166534}
    .badge-used{background:#1c1917;color:#78716c;border:1px solid #44403c}
    .badge-exp{background:#450a0a;color:#f87171;border:1px solid #7f1d1d}
    .stat{display:flex;gap:1.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .stat-box{flex:1;min-width:120px;background:#252836;border:1px solid #3a3f5c;border-radius:10px;padding:.85rem 1rem}
    .stat-label{font-size:.7rem;color:#64748b;margin-bottom:.3rem}
    .stat-val{font-size:1.3rem;font-weight:700;color:#f1f5f9}
    .sep{height:1px;background:#2d3148;margin:1.5rem 0}
    .link-box{background:#252836;border:1px solid #3a3f5c;border-radius:8px;padding:.6rem 1rem;font-size:.78rem;color:#818cf8;word-break:break-all;margin-top:.5rem}
    .mono{font-family:monospace}
    /* Wide 9Router-style dashboard */
    body{padding:0;background-color:#171717;background-image:linear-gradient(#2a241f66 1px,transparent 1px),linear-gradient(90deg,#2a241f66 1px,transparent 1px);background-size:48px 48px}.admin-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}.sidebar{background:#202020;border-right:1px solid #303030;padding:28px 16px;position:sticky;top:0;height:100vh}.side-brand{font-size:1.25rem;font-weight:800;color:#f5f5f5;margin:0 10px 30px}.side-brand b{display:block;color:#aaa;font-size:.75rem;margin-top:4px}.nav-item{display:block;padding:12px 14px;border-radius:9px;color:#aeb4c0;text-decoration:none;font-weight:650;margin:5px 0}.nav-item.active{background:#3c2b26;color:#f26a45}.nav-label{font-size:.72rem;color:#777d88;letter-spacing:.08em;margin:24px 14px 8px}.admin-main{padding:32px 48px;max-width:1600px;width:100%}.card{max-width:none;margin:0;background:#202020;border-color:#303030;box-shadow:none}.topbar{border-color:#343434}.brand-mark{background:#e75e3d}.dashboard-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.metric,.panel,.table-wrap{background:#242424;border-color:#343434}.metric{border-radius:14px}.btn-primary{background:#e75e3d}.btn-ghost{background:#2b2b2b;border-color:#454545}.section{border-color:#343434}@media(max-width:900px){.admin-shell{grid-template-columns:1fr}.sidebar{position:static;height:auto;padding:18px}.nav-item{display:inline-block}.admin-main{padding:18px}.dashboard-grid{grid-template-columns:repeat(2,1fr)}}
  `;
}

function layout(title: string, body: string) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Bot Admin</title>
  <style>${css()}</style>
</head><body>${body}</body></html>`;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function tokenStatus(t: { usedAt: number | null; expiresAt: number }) {
  if (t.usedAt) return `<span class="badge badge-used">Da dung</span>`;
  if (t.expiresAt < Date.now()) return `<span class="badge badge-exp">Het han</span>`;
  return `<span class="badge badge-ok">Con hieu luc</span>`;
}

// ═══════════════════════════════════════════════════════
// GET /admin/login
// ═══════════════════════════════════════════════════════
router.get("/admin/login", (req: Request, res: Response) => {
  const err = req.query["err"] ? "Token khong dung." : "";
  const ok = req.query["logout"] ? "Da dang xuat." : "";
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.send(layout("Dang nhap Admin", `
    <div class="card">
      <h1>🛡 Admin Login</h1>
      <p class="sub">Nhap Admin Token de truy cap trang quan tri bot.</p>
      ${err ? `<div class="alert-err">${err}</div>` : ""}
      ${ok ? `<div class="alert-ok">${ok}</div>` : ""}
      <form method="POST" action="/admin/login">
        <label>Admin Token</label>
        <input type="password" name="token" placeholder="Nhap token..." autofocus autocomplete="current-password" />
        <button type="submit" class="btn btn-primary" style="width:100%">Dang nhap</button>
      </form>
    </div>
  `));
});

// ═══════════════════════════════════════════════════════
// POST /admin/login
// ═══════════════════════════════════════════════════════
router.post("/admin/login", (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!ADMIN_TOKEN) {
    res.status(503).send("ADMIN_TOKEN chua duoc dat trong env.");
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
// ═══════════════════════════════════════════════════════
// GET /admin  — dashboard
// ═══════════════════════════════════════════════════════
router.get("/admin", requireAdmin, (req: Request, res: Response) => {
  const tokens = listUserTokens();
  const accounts = listAiAccounts();
  const serviceUsers = listServiceUsers();
  const connectedThreads = new Set(listUserAiConfigs().map(config => config.threadId));
  const activeUsers = serviceUsers.filter(user => user.active).length;
  const geminiUsers = serviceUsers.filter(user => connectedThreads.has(user.fbThreadId)).length;
  const geminiOk = req.query["geminiOk"] as string | undefined;
  const geminiErr = req.query["geminiErr"] as string | undefined;
  const created = req.query["created"] as string | undefined;
  const deleted = req.query["deleted"] as string | undefined;
  const accCreated = req.query["accCreated"] as string | undefined;
  const accDeleted = req.query["accDeleted"] as string | undefined;
  const baseOrigin = `${req.protocol}://${req.get("host")}`;

  const accRows = accounts.length === 0
    ? `<tr><td colspan="4" style="color:#4b5563;text-align:center;padding:1.5rem">Chua co tai khoan AI nao. Them o form duoi.</td></tr>`
    : accounts.map(a => `
        <tr>
          <td><div style="font-weight:600;color:#e2e8f0">${a.name}</div></td>
          <td class="mono" style="font-size:.75rem;color:#818cf8;max-width:200px;word-break:break-all">${a.baseUrl}</td>
          <td class="mono" style="font-size:.75rem;color:#64748b">${a.model}</td>
          <td><form method="POST" action="/admin/accounts/delete" style="display:inline"><input type="hidden" name="id" value="${a.id}" /><button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem">Xoa</button></form></td>
        </tr>`).join("");

  const accMap = new Map(accounts.map(a => [a.id, a]));
  const tokenRows = tokens.length === 0
    ? `<tr><td colspan="7" style="color:#4b5563;text-align:center;padding:1.5rem">Chua co link nao.</td></tr>`
    : tokens.map(t => {
        const geminiLink = `${baseOrigin}/connect/gemini?userToken=${t.id}`;
        const ttlLeft = Math.max(0, Math.round((t.expiresAt - Date.now()) / 60000));
        const accName = t.aiAccountId ? (accMap.get(t.aiAccountId)?.name ?? `<span style="color:#f87171">?</span>`) : `<span style="color:#64748b">Gemini OAuth</span>`;
        return `<tr>
          <td><div style="font-weight:600;color:#e2e8f0">${t.label}</div><div style="font-size:.7rem;color:#4b5563">${fmtDate(t.createdAt)}</div><div style="font-size:.7rem;color:#818cf8">Thread: ${t.fbThreadId || "-"}</div></td>
          <td>${tokenStatus(t)}</td>
          <td style="color:#64748b">${t.usedAt ? fmtDate(t.usedAt) : (t.expiresAt < Date.now() ? "Het han" : `Con ${ttlLeft} phut`)}</td>
          <td style="color:#94a3b8;font-size:.8rem">${accName}</td>
          <td style="color:#e2e8f0;max-width:140px;word-break:break-all">${t.usedByLabel ? `<span style="color:#4ade80">${t.usedByLabel}</span>` : `<span style="color:#4b5563">-</span>`}</td>
          <td class="mono" style="max-width:260px"><div class="link-box">${geminiLink}</div></td>
          <td><form method="POST" action="/admin/links/delete" style="display:inline"><input type="hidden" name="id" value="${t.id}" /><button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem">Xoa</button></form></td>
        </tr>`;
      }).join("");

  const serviceUserRows = serviceUsers.length === 0 ? `<tr><td colspan="7" style="color:#4b5563;text-align:center;padding:2rem">Chua co khach hang nao. Tao khach hang dau tien o form ben duoi.</td></tr>` : serviceUsers.map(u => `<tr><td><div style="font-weight:700;color:#f1f5f9">${u.name}</div><div class="mono" style="font-size:.72rem;color:#818cf8;margin-top:3px">ID: ${u.id}</div></td><td class="mono" style="font-size:.76rem">${u.fbThreadId}</td><td style="font-size:.78rem;color:#94a3b8">${fmtDate(u.createdAt)}</td><td>${u.active ? `<span class="badge badge-ok">Hoat dong</span>` : `<span class="badge badge-exp">Da khoa</span>`}</td><td>${connectedThreads.has(u.fbThreadId) ? `<span class="badge badge-ok">Da ket noi</span>` : `<span class="badge badge-used">Chua ket noi</span>`}</td><td><a href="${baseOrigin}/u/${u.id}" target="_blank" rel="noreferrer" class="mono" style="font-size:.75rem;color:#818cf8">/u/${u.id} ↗</a></td><td style="white-space:nowrap"><form method="POST" action="/admin/users/toggle" style="display:inline"><input type="hidden" name="id" value="${u.id}"><input type="hidden" name="active" value="${u.active ? "0" : "1"}"><button class="btn btn-ghost" style="padding:.35rem .7rem;font-size:.75rem">${u.active ? "Khoa" : "Mo"}</button></form> <form method="POST" action="/admin/users/delete" style="display:inline"><input type="hidden" name="id" value="${u.id}"><button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem">Xoa</button></form></td></tr>`).join("");

  const accOptions = accounts.length === 0
    ? `<option value="">- Chua co tai khoan AI -</option>`
    : accounts.map(a => `<option value="${a.id}">${a.name} (${a.model})</option>`).join("");

  const alerts = [
    geminiOk ? `<div class="alert-ok">&#x2713; Da ket noi Gemini thanh cong! Model: ${botState.aiModel}</div>` : "",
    geminiErr ? `<div class="alert-err">&#x26A0; Loi ket noi Gemini: ${decodeURIComponent(geminiErr)}</div>` : "",
    created ? `<div class="alert-ok">Da tao link.</div>` : "",
    deleted ? `<div class="alert-err">Da xoa link.</div>` : "",
    accCreated ? `<div class="alert-ok">Da them tai khoan AI.</div>` : "",
    accDeleted ? `<div class="alert-err">Da xoa tai khoan AI.</div>` : "",
  ].join("");

  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.send(layout("Admin Dashboard", `
    <div class="admin-shell"><aside class="sidebar"><div class="side-brand">Bot Router<b>CONTROL PANEL</b></div><a class="nav-item active" href="/admin">▦ Dashboard</a><a class="nav-item" href="#customers">♙ Khach hang</a><a class="nav-item" href="#accounts">◇ AI Accounts</a><a class="nav-item" href="#links">↗ Gemini links</a><div class="nav-label">SYSTEM</div><a class="nav-item" href="/">⌂ Landing page</a></aside><main class="admin-main"><div class="card">
      <header class="topbar">
        <div class="brand"><div class="brand-mark">◆</div><div><div class="page-title">Trung tam quan tri</div><div class="page-sub">Quan ly khach hang, ket noi Gemini va Facebook Bot</div></div></div>
        <form method="POST" action="/admin/logout"><button class="btn btn-ghost">Dang xuat</button></form>
      </header>
      <div class="dashboard-grid">
        <div class="metric"><div class="metric-label">Tong khach hang</div><div class="metric-value">${serviceUsers.length}</div><div class="metric-foot">Link con da cap phep</div></div>
        <div class="metric"><div class="metric-label">Dang hoat dong</div><div class="metric-value" style="color:#4ade80">${activeUsers}</div><div class="metric-foot">${serviceUsers.length - activeUsers} tai khoan dang khoa</div></div>
        <div class="metric"><div class="metric-label">Da ket noi Gemini</div><div class="metric-value" style="color:#818cf8">${geminiUsers}</div><div class="metric-foot">Theo FB Thread ID</div></div>
        <div class="metric"><div class="metric-label">Bot Messenger</div><div class="metric-value" style="font-size:1.1rem;padding-top:7px;text-transform:capitalize">${botState.status}</div><div class="metric-foot">${botState.messagesHandled} tin nhan da xu ly</div></div>
      </div>
      <div style="display:flex;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap">
        <a href="/" class="btn btn-ghost">Dashboard</a>
        <a href="/ai-config" class="btn btn-ghost">AI Config</a>
        <a href="/connect/gemini" class="btn btn-primary" style="background:linear-gradient(135deg,#4285f4,#34a853)">&#x1F1EC;&#x1F1F4; Ket noi Gemini</a>
        <a href="/connect/9router" class="btn btn-ghost">9Router</a>
      </div>
      ${alerts}
      <section id="customers" class="section">
        <div class="section-head"><div><div class="section-title">Khach hang dich vu</div><div class="section-note">Moi khach hang co URL, mat khau, FB Thread va Gemini rieng.</div></div><span class="badge badge-ok">${activeUsers} dang hoat dong</span></div>
        <div class="panel" style="margin-bottom:16px"><form method="POST" action="/admin/users/create" class="form-grid">
          <div><label>Ten khach hang</label><input name="name" required maxlength="80" placeholder="Cong ty ABC"></div>
          <div><label>ID link con</label><input name="id" required pattern="[a-z0-9-]{3,48}" placeholder="cong-ty-abc"></div>
          <div><label>Mat khau</label><input name="password" type="password" required minlength="8" placeholder="Toi thieu 8 ky tu"></div>
          <div><label>FB Thread ID</label><input name="fbThreadId" required placeholder="1234567890"></div>
          <div class="span-all"><button class="btn btn-primary">+ Tao khach hang va link con</button></div>
        </form></div>
        <div class="table-wrap"><table><thead><tr><th>Khach hang</th><th>FB Thread ID</th><th>Ngay dang ky</th><th>Trang thai</th><th>Gemini</th><th>Trang con</th><th>Thao tac</th></tr></thead><tbody>${serviceUserRows}</tbody></table></div>
      </section>
      <div class="sep"></div>
      <h2 id="accounts" style="font-size:1rem;margin-bottom:1rem;color:#f1f5f9">Tai khoan AI (${accounts.length})</h2>
      <div style="overflow-x:auto"><table><thead><tr><th>Ten</th><th>Base URL</th><th>Model</th><th></th></tr></thead><tbody>${accRows}</tbody></table></div>
      <details style="margin-top:1rem">
        <summary style="cursor:pointer;color:#6366f1;font-size:.85rem;font-weight:600;padding:.5rem 0">+ Them tai khoan AI moi</summary>
        <form method="POST" action="/admin/accounts/create" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;align-items:end;margin-top:.75rem">
          <div><label>Ten hien thi</label><input name="name" placeholder="9Router Production" required /></div>
          <div><label>Base URL</label><input name="baseUrl" placeholder="https://api.9router.dev/v1" required /></div>
          <div><label>API Key</label><input name="apiKey" type="password" placeholder="sk-..." required /></div>
          <div><label>Model</label><input name="model" placeholder="cc/claude-opus-4-5" required /></div>
          <div style="grid-column:1/-1"><button class="btn btn-primary" style="width:100%">Them tai khoan AI</button></div>
        </form>
      </details>
      <div class="sep"></div>
      <h2 id="links" style="font-size:1rem;margin-bottom:1rem;color:#f1f5f9">Tao link ket noi Gemini cho nguoi dung</h2>
      <form method="POST" action="/admin/links/create" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;align-items:end">
        <div><label>Nhan (ten nguoi dung)</label><input name="label" placeholder="Khach hang A" required /></div>
        <div><label>FB Thread ID (ID cuoc tro chuyen)</label><input name="fbThreadId" placeholder="1234567890" required title="Lay tu URL facebook.com/messages/t/[ID]" /></div>
        <div><label>Tai khoan AI (tuy chon)</label><select name="aiAccountId"><option value="">- Khong chon (dung Gemini OAuth) -</option>${accOptions}</select></div>
        <div><label>Hieu luc</label><select name="ttlHours"><option value="1">1 gio</option><option value="6">6 gio</option><option value="24" selected>24 gio</option><option value="72">3 ngay</option><option value="168">7 ngay</option></select></div>
        <div style="grid-column:1/-1"><button class="btn btn-primary" style="width:100%">Tao link Gemini</button></div>
      </form>
      <div class="sep"></div>
      <h2 style="font-size:1rem;margin-bottom:.5rem;color:#f1f5f9">Danh sach link (${tokens.length})</h2>
      <div style="overflow-x:auto"><table><thead><tr><th>Nhan</th><th>Trang thai</th><th>Het han</th><th>Tai khoan AI</th><th>Nguoi dung</th><th>Link</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table></div>
    </div></main></div>
  `));
});

router.post("/admin/users/create", requireAdmin, (req: Request, res: Response) => {
  const { id, name, password, fbThreadId } = req.body as { id?: string; name?: string; password?: string; fbThreadId?: string };
  const safeId = id?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9-]{3,48}$/.test(safeId) || !name?.trim() || !fbThreadId?.trim() || !password || password.length < 8) { res.status(400).send("Thong tin user khong hop le. ID dung a-z, 0-9, -, dai 3-48; mat khau toi thieu 8 ky tu."); return; }
  try { createServiceUser({ id: safeId, name: name.trim().slice(0, 80), password, fbThreadId: fbThreadId.trim() }); res.redirect("/admin"); }
  catch (err: any) { res.status(409).send(err?.message ?? "Khong tao duoc user."); }
});
router.post("/admin/users/toggle", requireAdmin, (req: Request, res: Response) => { const { id, active } = req.body as { id?: string; active?: string }; if (id) setServiceUserActive(id, active === "1"); res.redirect("/admin"); });
router.post("/admin/users/delete", requireAdmin, (req: Request, res: Response) => { const { id } = req.body as { id?: string }; if (id) deleteServiceUser(id); res.redirect("/admin"); });

router.post("/admin/accounts/create", requireAdmin, (req: Request, res: Response) => {
  const { name, baseUrl, apiKey, model } = req.body as { name?: string; baseUrl?: string; apiKey?: string; model?: string };
  if (!name || !baseUrl || !apiKey || !model) { res.status(400).send("Thieu thong tin."); return; }
  createAiAccount({ name: name.trim().slice(0, 80), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim().slice(0, 100) });
  res.redirect("/admin?accCreated=1");
});

router.post("/admin/accounts/delete", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (id) deleteAiAccount(id);
  res.redirect("/admin?accDeleted=1");
});

router.post("/admin/links/create", requireAdmin, (req: Request, res: Response) => {
  const { label, ttlHours, redirectUrl, aiAccountId, fbThreadId } = req.body as { label?: string; ttlHours?: string; redirectUrl?: string; aiAccountId?: string; fbThreadId?: string };
  if (!fbThreadId?.trim()) { res.status(400).send("Phai nhap FB Thread ID."); return; }
  const safeLabel = (label ?? "User").slice(0, 80);
  const ttl = Math.min(Math.max(Number(ttlHours ?? 24), 1), 720);
  const redirect = (redirectUrl ?? "").trim() || `${req.protocol}://${req.get("host")}/`;
  createUserToken({ label: safeLabel, aiAccountId: aiAccountId ?? "", fbThreadId: fbThreadId.trim(), ttlHours: ttl, redirectUrl: redirect });
  res.redirect("/admin?created=1");
});

router.post("/admin/links/delete", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (id) deleteUserToken(id);
  res.redirect("/admin?deleted=1");
});

export default router;