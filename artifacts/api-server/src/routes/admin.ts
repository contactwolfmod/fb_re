import { Router, type IRouter, type Request, type Response } from "express";
import {
  ADMIN_TOKEN,
  requireAdmin,
  createUserToken,
  listUserTokens,
  deleteUserToken,
} from "../lib/adminAuth";
import { botState } from "../bot/state";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function css() {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{background:#1a1d27;border:1px solid #2d3148;border-radius:12px;padding:2rem;width:100%;max-width:640px;box-shadow:0 8px 32px #0008}
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
router.get("/admin", requireAdmin, (req: Request, res: Response) => {
  const tokens = listUserTokens();
  const created = req.query["created"] as string | undefined;
  const deleted = req.query["deleted"] as string | undefined;

  const baseOrigin = `${req.protocol}://${req.get("host")}`;

  const tokenRows = tokens.length === 0
    ? `<tr><td colspan="6" style="color:#4b5563;text-align:center;padding:1.5rem">Chua co link nao. Tao link o form duoi.</td></tr>`
    : tokens.map(t => {
        const link = `${baseOrigin}/connect/9router?userToken=${t.id}&redirect=${encodeURIComponent(t.redirectUrl)}`;
        const ttlLeft = Math.max(0, Math.round((t.expiresAt - Date.now()) / 60000));
        return `
          <tr>
            <td>
              <div style="font-weight:600;color:#e2e8f0">${t.label}</div>
              <div style="font-size:.7rem;color:#4b5563">${fmtDate(t.createdAt)}</div>
            </td>
            <td>${tokenStatus(t)}</td>
            <td style="color:#64748b">${t.usedAt ? fmtDate(t.usedAt) : (t.expiresAt < Date.now() ? "Het han" : `Con ${ttlLeft} phut`)}</td>
            <td style="color:#e2e8f0;max-width:140px;word-break:break-all">${t.usedByLabel ? `<span style="color:#4ade80">${t.usedByLabel}</span>` : `<span style="color:#4b5563">—</span>`}</td>
            <td class="mono" style="max-width:260px">
              <div class="link-box">${link}</div>
            </td>
            <td>
              <form method="POST" action="/admin/links/delete" style="display:inline">
                <input type="hidden" name="id" value="${t.id}" />
                <button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem">Xoa</button>
              </form>
            </td>
          </tr>
        `;
      }).join("");

  const newLink = created
    ? `<div class="alert-ok">Da tao link. Copy o bang ben duoi.</div>`
    : "";
  const delMsg = deleted
    ? `<div class="alert-err">Da xoa token.</div>`
    : "";

  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.send(layout("Admin Dashboard", `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <div>
          <h1>🤖 Bot Admin</h1>
          <p class="sub">Quan ly bot va tao link cau hinh cho nguoi dung.</p>
        </div>
        <form method="POST" action="/admin/logout">
          <button class="btn btn-ghost">Dang xuat</button>
        </form>
      </div>

      <div class="stat">
        <div class="stat-box">
          <div class="stat-label">Trang thai bot</div>
          <div class="stat-val" style="font-size:1rem;text-transform:capitalize">${botState.status}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Tin nhan xu ly</div>
          <div class="stat-val">${botState.messagesHandled}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">AI Model</div>
          <div class="stat-val" style="font-size:.75rem;font-family:monospace;padding-top:.35rem">${botState.aiModel || "chua cau hinh"}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">9Router URL</div>
          <div class="stat-val" style="font-size:.7rem;font-family:monospace;padding-top:.35rem">${botState.aiBaseUrl || "chua cau hinh"}</div>
        </div>
      </div>

      <div style="display:flex;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap">
        <a href="/" class="btn btn-ghost">&#8594; Dashboard React</a>
        <a href="/ai-config" class="btn btn-ghost">&#8594; AI Config</a>
        <a href="/connect/9router?redirect=${encodeURIComponent(baseOrigin + "/ai-config")}" class="btn btn-primary">Ket noi 9Router</a>
      </div>

      <div class="sep"></div>
      <h2 style="font-size:1rem;margin-bottom:1rem;color:#f1f5f9">Tao link cau hinh cho nguoi dung</h2>
      ${newLink}${delMsg}
      <form method="POST" action="/admin/links/create" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;align-items:end">
        <div>
          <label>Nhan (ten nguoi dung / mo ta)</label>
          <input name="label" placeholder="Khach hang A" required />
        </div>
        <div>
          <label>Redirect sau khi ket noi</label>
          <input name="redirectUrl" value="${baseOrigin}/ai-config" />
        </div>
        <div>
          <label>Hieu luc (gio)</label>
          <select name="ttlHours">
            <option value="1">1 gio</option>
            <option value="6">6 gio</option>
            <option value="24" selected>24 gio</option>
            <option value="72">3 ngay</option>
            <option value="168">7 ngay</option>
          </select>
        </div>
        <div style="padding-bottom:1rem">
          <button class="btn btn-primary" style="width:100%">Tao link</button>
        </div>
      </form>

      <div class="sep"></div>
      <h2 style="font-size:1rem;margin-bottom:.5rem;color:#f1f5f9">Danh sach link (<span>${tokens.length}</span>)</h2>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Nhan</th><th>Trang thai</th><th>Het han / Da dung</th><th>Nguoi dung</th><th>Link</th><th></th></tr></thead>
          <tbody>${tokenRows}</tbody>
        </table>
      </div>
    </div>
  `));
});

// ═══════════════════════════════════════════════════════
// POST /admin/links/create
// ═══════════════════════════════════════════════════════
router.post("/admin/links/create", requireAdmin, (req: Request, res: Response) => {
  const { label, ttlHours, redirectUrl } = req.body as { label?: string; ttlHours?: string; redirectUrl?: string };
  const safeLabel = (label ?? "User").slice(0, 80);
  const ttl = Math.min(Math.max(Number(ttlHours ?? 24), 1), 720);
  const redirect = (redirectUrl ?? "").trim() || `${req.protocol}://${req.get("host")}/ai-config`;
  createUserToken({ label: safeLabel, ttlHours: ttl, redirectUrl: redirect });
  res.redirect("/admin?created=1");
});

// ═══════════════════════════════════════════════════════
// POST /admin/links/delete
// ═══════════════════════════════════════════════════════
router.post("/admin/links/delete", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (id) deleteUserToken(id);
  res.redirect("/admin?deleted=1");
});

export default router;