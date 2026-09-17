import { Router, type Request, type Response } from "express";
import {
  authenticateServiceUser,
  createUserSession,
  deleteUserSession,
  getSessionUser,
  getServiceUser,
  getUserAiConfig,
  updateUserAiModel,
  fetchGeminiModels,
  setServiceUserReplyMode,
  addServiceUserThread,
  removeServiceUserThread,
  type ServiceUser,
} from "../lib/adminAuth";
import { getClaudeReply } from "../bot/claude";
import { botState } from "../bot/state";

const router = Router();
const validId = /^[a-z0-9-]{3,48}$/;
const validModel = /^[a-zA-Z0-9._:/-]{2,100}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font:15px system-ui;background:#0b0d14;color:#e2e8f0}.wrap{max-width:860px;margin:auto;padding:28px 18px}.card{background:#121624;border:1px solid #23293e;border-radius:12px;padding:20px;margin-bottom:18px}input,select,textarea{width:100%;padding:11px;border-radius:8px;border:1px solid #333a52;background:#080a10;color:#fff;font-size:14px;margin:6px 0 14px}input[type=radio]{width:auto;margin:4px 0 0}button,a.btn{display:inline-flex;align-items:center;gap:6px;background:#6366f1;color:#fff;border:0;border-radius:8px;padding:10px 16px;text-decoration:none;font-weight:600;cursor:pointer}.btn-google{background:linear-gradient(135deg,#4285f4,#34a853);font-size:15px;padding:12px 20px}.btn-sub{background:#1f2538;border:1px solid #333a52}.muted{color:#94a3b8}.alert{padding:12px 14px;border-radius:8px;margin-bottom:16px}.alert-ok{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);color:#86efac}.alert-err{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5}.row{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}.messages{min-height:220px;max-height:50vh;overflow-y:auto;margin:14px 0;padding:10px;background:#080a10;border-radius:8px;border:1px solid #1f2538}.msg{padding:10px 12px;margin:8px 0;border-radius:8px;background:#181d2e;white-space:pre-wrap}.me{background:#312e81}.bot{background:#1e2438}.mode-option{display:flex;gap:10px;align-items:flex-start;cursor:pointer;padding:10px 0}.thread-item{background:#080a10;border:1px solid #1f2538;border-radius:8px;padding:8px 12px;margin-bottom:8px}
</style><body><main class="wrap">${body}</main></body></html>`;
}

function current(req: Request, id: string) {
  const u = getSessionUser((req as any).cookies?.userSession);
  return u?.id === id ? u : undefined;
}

function replyModeCard(id: string, user: ServiceUser) {
  const threadList = user.threadIds.length === 0
    ? `<p class="muted" style="font-size:13px;margin-top:4px">Chưa có hội thoại nào — thêm Thread ID ở trên.</p>`
    : user.threadIds.map(tid => `
      <div class="row thread-item">
        <span style="font-family:monospace;font-size:13px;color:#818cf8">${esc(tid)}</span>
        <form method="post" action="/u/${id}/threads/remove" style="margin:0">
          <input type="hidden" name="threadId" value="${esc(tid)}">
          <button type="submit" class="btn-sub" style="padding:6px 12px;font-size:12px;margin:0">Xóa</button>
        </form>
      </div>`).join("");

  return `<div class="card">
    <h3 style="margin-top:0">⚙️ Cấu hình trả lời tự động</h3>
    <p class="muted" style="margin-bottom:4px">Chọn cách bot tự động trả lời tin nhắn Messenger cho tài khoản của bạn.</p>
    <form method="post" action="/u/${id}/reply-mode" style="margin:10px 0 0">
      <label class="mode-option">
        <input type="radio" name="mode" value="all" ${user.replyMode === "all" ? "checked" : ""} onchange="this.form.requestSubmit()">
        <span><strong>Trả lời tất cả hội thoại</strong><br><span class="muted" style="font-size:13px">Bot sẽ tự động trả lời mọi tin nhắn Messenger gửi đến.</span></span>
      </label>
      <label class="mode-option">
        <input type="radio" name="mode" value="specific" ${user.replyMode === "specific" ? "checked" : ""} onchange="this.form.requestSubmit()">
        <span><strong>Chỉ trả lời hội thoại cụ thể</strong><br><span class="muted" style="font-size:13px">Chỉ tự động trả lời những cuộc trò chuyện bạn thêm bên dưới.</span></span>
      </label>
    </form>
    ${user.replyMode === "specific" ? `
      <div style="height:1px;background:#23293e;margin:14px 0"></div>
      <label style="font-size:13px;font-weight:600">Danh sách hội thoại (Thread ID)</label>
      <form method="post" action="/u/${id}/threads/add" style="display:flex;gap:8px;align-items:flex-start">
        <input name="threadId" placeholder="Ví dụ: 1234567890" pattern="\\d{5,32}" required style="margin:0" title="Lấy từ URL facebook.com/messages/t/[ID]">
        <button type="submit" style="white-space:nowrap;margin:0">+ Thêm</button>
      </form>
      ${threadList}
    ` : ""}
  </div>`;
}

router.get("/u/:id", async (req: Request, res: Response): Promise<void> => {
  const id = (req.params.id as string).toLowerCase();
  const user = getServiceUser(id);
  if (!validId.test(id) || !user) { res.status(404).send("Không tìm thấy trang."); return; }

  if (!current(req, id)) {
    const err = req.query["err"] ? `<div class="alert alert-err">Mật khẩu không đúng.</div>` : "";
    res.send(page("Đăng nhập", `<div class="card" style="max-width:420px;margin:60px auto">
      <h2 style="margin-top:0">${esc(user.name)}</h2>
      <p class="muted">Đăng nhập để quản lý và chọn model Gemini của bạn.</p>
      ${err}
      <form method="post" action="/u/${id}/login">
        <label style="font-size:13px;font-weight:600">Mật khẩu</label>
        <input type="password" name="password" minlength="8" required autofocus placeholder="Nhập mật khẩu...">
        <button style="width:100%">Đăng nhập &rarr;</button>
      </form>
    </div>`));
    return;
  }

  const c = getUserAiConfig(user.id);
  const geminiOk = req.query["geminiOk"] ? `<div class="alert alert-ok">&#x2705; Đã kết nối tài khoản Google thành công! Hãy chọn model Gemini bên dưới.</div>` : "";
  const modelSaved = req.query["modelSaved"] ? `<div class="alert alert-ok">&#x2705; Đã cập nhật model Gemini thành công! Bot Facebook sẽ trả lời bằng model này.</div>` : "";
  const modelErr = req.query["modelErr"] ? `<div class="alert alert-err">&#x26A0; Không lưu được model. Vui lòng kiểm tra lại.</div>` : "";
  const threadErr = req.query["threadErr"] ? `<div class="alert alert-err">&#x26A0; ${esc(decodeURIComponent(String(req.query["threadErr"])))}</div>` : "";

  let aiBlock = "";
  if (c && c.accessToken) {
    const models = await fetchGeminiModels(c.accessToken);
    if (!models.includes(c.model)) models.unshift(c.model);
    const opts = models.map(m => `<option value="${esc(m)}" ${m === c.model ? "selected" : ""}>${esc(m)}${m === c.model ? " (đang dùng)" : ""}</option>`).join("");

    aiBlock = `<div class="card">
      <div class="row" style="margin-bottom:12px">
        <div>
          <h3 style="margin:0 0 4px">&#x2728; Model Gemini từ tài khoản Google của bạn</h3>
          <span style="color:#4ade80;font-size:13px;font-weight:600">&#x25CF; Đã kết nối Google account</span>
        </div>
        <a class="btn btn-sub" href="/u/${id}/gemini">&#x21BB; Kết nối Google khác</a>
      </div>
      <p class="muted" style="margin-bottom:16px">Danh sách model có thể dùng trên tài khoản Google của bạn. Chọn model để kết nối:</p>
      <form method="post" action="/u/${id}/model">
        <label style="font-size:13px;font-weight:600">Chọn Model Gemini:</label>
        <select name="model" required>${opts}</select>
        <div style="margin-top:-6px;margin-bottom:14px">
          <label style="font-size:12px;color:#94a3b8">Hoặc tự gõ model khác (tùy chọn):</label>
          <input name="customModel" placeholder="Để trống để dùng model ở trên..." style="margin-top:4px">
        </div>
        <button type="submit">&#x1F4BE; Lưu Model</button>
      </form>
    </div>`;
  } else {
    aiBlock = `<div class="card" style="border-color:#3b82f6;background:linear-gradient(180deg,#121a30,#121624)">
      <h3 style="margin:0 0 8px">&#x1F517; Kết nối tài khoản Google để dùng Gemini</h3>
      <p class="muted" style="line-height:1.6;margin-bottom:18px">
        Bấm nút bên dưới để đăng nhập Google. Hệ thống sẽ lấy danh sách các model Gemini có trên tài khoản Google của bạn để bạn chọn model kết nối vào bot!
      </p>
      <a class="btn btn-google" href="/u/${id}/gemini">&#x1F511; Đăng nhập Google &amp; Kết nối Gemini &rarr;</a>
    </div>`;
  }

  res.send(page(user.name, `
    <div class="row" style="margin-bottom:20px">
      <div>
        <h2 style="margin:0 0 4px">${esc(user.name)}</h2>
        <p class="muted" style="margin:0">Chế độ trả lời: <strong style="color:#818cf8">${user.replyMode === "all" ? "Tất cả hội thoại" : `${user.threadIds.length} hội thoại cụ thể`}</strong></p>
      </div>
      <form method="post" action="/u/${id}/logout" style="margin:0"><button class="btn btn-sub">Đăng xuất</button></form>
    </div>
    ${geminiOk}${modelSaved}${modelErr}${threadErr}
    ${replyModeCard(id, user)}
    ${aiBlock}
    <div class="card">
      <h3 style="margin-top:0">&#x1F4AC; Test Chat trực tiếp</h3>
      <div id="messages" class="messages"><div class="msg bot">&#x1F916; Sẵn sàng test với model Gemini của bạn.</div></div>
      <form id="chat" style="margin:0">
        <textarea id="prompt" required placeholder="Nhập tin nhắn test..." rows="2" style="resize:vertical"></textarea>
        <button id="sbtn" type="submit">Gửi tin nhắn</button>
      </form>
    </div>
    <script>
      const m = document.querySelector("#messages"), f = document.querySelector("#chat"), p = document.querySelector("#prompt"), btn = document.querySelector("#sbtn");
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = p.value.trim();
        if (!v) return;
        m.innerHTML += '<div class="msg me">' + v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</div>';
        p.value = '';
        m.scrollTop = m.scrollHeight;
        btn.disabled = true;
        btn.textContent = 'Đang xử lý...';
        try {
          const res = await fetch('/u/${id}/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ prompt: v }) });
          const d = await res.json();
          m.innerHTML += '<div class="msg bot">' + (d.reply || d.error || 'Không có phản hồi').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</div>';
        } catch (err) {
          m.innerHTML += '<div class="msg bot" style="color:#fca5a5">Lỗi: ' + err.message + '</div>';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Gửi tin nhắn';
          m.scrollTop = m.scrollHeight;
        }
      };
    </script>
  `));
});
router.post("/u/:id/login", (req,res) => { const id=req.params.id.toLowerCase(); const u=authenticateServiceUser(id,String(req.body.password??"")); if(!u)return res.redirect(`/u/${id}?err=1`); res.cookie("userSession",createUserSession(id),{httpOnly:true,sameSite:"lax",secure:req.secure,maxAge:604800000});res.redirect(`/u/${id}`); });
router.post("/u/:id/logout",(req,res)=>{deleteUserSession((req as any).cookies?.userSession);res.clearCookie("userSession");res.redirect(`/u/${req.params.id}`)});
router.get("/u/:id/gemini", (req, res) => { const u=current(req,req.params.id.toLowerCase()); if(!u)return res.redirect(`/u/${req.params.id}`); res.redirect("/connect/gemini"); });
router.post("/u/:id/model", (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = current(req, id);
  const rawModel = String(req.body.customModel?.trim() || req.body.model?.trim() || "");
  const cleanModel = rawModel.replace(/^models\//, "").trim();
  if (!u || !validModel.test(cleanModel) || !updateUserAiModel(u.id, cleanModel)) {
    res.redirect(`/u/${id}?modelErr=1`);
    return;
  }
  res.redirect(`/u/${id}?modelSaved=1`);
});
router.post("/u/:id/reply-mode", (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = current(req, id);
  if (u) setServiceUserReplyMode(id, req.body.mode === "all" ? "all" : "specific");
  res.redirect(`/u/${id}`);
});
router.post("/u/:id/threads/add", (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = current(req, id);
  if (!u) { res.redirect(`/u/${id}`); return; }
  const result = addServiceUserThread(id, String(req.body.threadId ?? ""));
  res.redirect(result.ok ? `/u/${id}` : `/u/${id}?threadErr=${encodeURIComponent(result.error ?? "Loi khong xac dinh.")}`);
});
router.post("/u/:id/threads/remove", (req: Request, res: Response) => {
  const id = (req.params.id as string).toLowerCase();
  const u = current(req, id);
  if (u) removeServiceUserThread(id, String(req.body.threadId ?? ""));
  res.redirect(`/u/${id}`);
});
router.post("/u/:id/chat",async(req,res): Promise<void>=>{const u=current(req,req.params.id.toLowerCase());const prompt=String(req.body.prompt??"").trim();if(!u){res.status(401).json({error:"Cần đăng nhập."});return;}if(!prompt){res.status(400).json({error:"Thiếu tin nhắn."});return;}try{res.json({reply:await getClaudeReply(u.id,prompt,botState.systemPrompt)})}catch{res.status(502).json({error:"AI chưa sẵn sàng. Hãy kết nối Gemini hoặc liên hệ admin."})}});
export default router;
