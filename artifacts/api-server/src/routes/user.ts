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
} from "../lib/adminAuth";
import { getClaudeReply } from "../bot/claude";
import { botState } from "../bot/state";

const router = Router();
const validId = /^[a-z0-9-]{3,48}$/;
const validModel = /^[a-zA-Z0-9._:/-]{2,100}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font:15px system-ui;background:#0b0d14;color:#e2e8f0}.wrap{max-width:860px;margin:auto;padding:28px 18px}.card{background:#121624;border:1px solid #23293e;border-radius:12px;padding:20px;margin-bottom:18px}input,select,textarea{width:100%;padding:11px;border-radius:8px;border:1px solid #333a52;background:#080a10;color:#fff;font-size:14px;margin:6px 0 14px}button,a.btn{display:inline-flex;align-items:center;gap:6px;background:#6366f1;color:#fff;border:0;border-radius:8px;padding:10px 16px;text-decoration:none;font-weight:600;cursor:pointer}.btn-google{background:linear-gradient(135deg,#4285f4,#34a853);font-size:15px;padding:12px 20px}.btn-sub{background:#1f2538;border:1px solid #333a52}.muted{color:#94a3b8}.alert{padding:12px 14px;border-radius:8px;margin-bottom:16px}.alert-ok{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);color:#86efac}.alert-err{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5}.row{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}.messages{min-height:220px;max-height:50vh;overflow-y:auto;margin:14px 0;padding:10px;background:#080a10;border-radius:8px;border:1px solid #1f2538}.msg{padding:10px 12px;margin:8px 0;border-radius:8px;background:#181d2e;white-space:pre-wrap}.me{background:#312e81}.bot{background:#1e2438}
</style><body><main class="wrap">${body}</main></body></html>`;
}

function current(req: Request, id: string) {
  const u = getSessionUser((req as any).cookies?.userSession);
  return u?.id === id ? u : undefined;
}
router.get("/u/:id", async (req: Request, res: Response): Promise<void> => {
  const id = (req.params.id as string).toLowerCase();
  const user = getServiceUser(id);
  if (!validId.test(id) || !user) { res.status(404).send("Khong tim thay trang."); return; }

  if (!current(req, id)) {
    const err = req.query["err"] ? `<div class="alert alert-err">Mat khau khong dung.</div>` : "";
    res.send(page("Dang nhap", `<div class="card" style="max-width:420px;margin:60px auto">
      <h2 style="margin-top:0">${esc(user.name)}</h2>
      <p class="muted">Dang nhap de quan ly va chon model Gemini cua ban.</p>
      ${err}
      <form method="post" action="/u/${id}/login">
        <label style="font-size:13px;font-weight:600">Mat khau</label>
        <input type="password" name="password" minlength="8" required autofocus placeholder="Nhap mat khau...">
        <button style="width:100%">Dang nhap &rarr;</button>
      </form>
    </div>`));
    return;
  }

  const c = getUserAiConfig(user.fbThreadId);
  const geminiOk = req.query["geminiOk"] ? `<div class="alert alert-ok">&#x2705; Da ket noi tai khoan Google thanh cong! Hay chon model Gemini ben duoi.</div>` : "";
  const modelSaved = req.query["modelSaved"] ? `<div class="alert alert-ok">&#x2705; Da cap nhat model Gemini thanh cong! Bot Facebook se tra loi bang model nay.</div>` : "";
  const modelErr = req.query["modelErr"] ? `<div class="alert alert-err">&#x26A0; Khong luu duoc model. Vui long kiem tra lai.</div>` : "";

  let aiBlock = "";
  if (c && c.accessToken) {
    const models = await fetchGeminiModels(c.accessToken);
    if (!models.includes(c.model)) models.unshift(c.model);
    const opts = models.map(m => `<option value="${esc(m)}" ${m === c.model ? "selected" : ""}>${esc(m)}${m === c.model ? " (dang dung)" : ""}</option>`).join("");

    aiBlock = `<div class="card">
      <div class="row" style="margin-bottom:12px">
        <div>
          <h3 style="margin:0 0 4px">&#x2728; Model Gemini tu tai khoan Google cua ban</h3>
          <span style="color:#4ade80;font-size:13px;font-weight:600">&#x25CF; Da ket noi Google account</span>
        </div>
        <a class="btn btn-sub" href="/u/${id}/gemini">&#x21BB; Ket noi Google khac</a>
      </div>
      <p class="muted" style="margin-bottom:16px">Danh sach model co the dung tren tai khoan Google cua ban. Chon model de ket noi:</p>
      <form method="post" action="/u/${id}/model">
        <label style="font-size:13px;font-weight:600">Chon Model Gemini:</label>
        <select name="model" required>${opts}</select>
        <div style="margin-top:-6px;margin-bottom:14px">
          <label style="font-size:12px;color:#94a3b8">Hoac tu go model khac (tuy chon):</label>
          <input name="customModel" placeholder="De trong de dung model o tren..." style="margin-top:4px">
        </div>
        <button type="submit">&#x1F4BE; Luu Model</button>
      </form>
    </div>`;
  } else {
    aiBlock = `<div class="card" style="border-color:#3b82f6;background:linear-gradient(180deg,#121a30,#121624)">
      <h3 style="margin:0 0 8px">&#x1F517; Ket noi tai khoan Google de dung Gemini</h3>
      <p class="muted" style="line-height:1.6;margin-bottom:18px">
        Bam nut ben duoi de dang nhap Google. He thong se lay danh sach cac model Gemini co tren tai khoan Google cua ban de ban chon model ket noi vao bot!
      </p>
      <a class="btn btn-google" href="/u/${id}/gemini">&#x1F511; Dang nhap Google &amp; Ket noi Gemini &rarr;</a>
    </div>`;
  }

  res.send(page(user.name, `
    <div class="row" style="margin-bottom:20px">
      <div>
        <h2 style="margin:0 0 4px">${esc(user.name)}</h2>
        <p class="muted" style="margin:0">Messenger Thread ID: <strong style="color:#818cf8">${esc(user.fbThreadId)}</strong></p>
      </div>
      <form method="post" action="/u/${id}/logout" style="margin:0"><button class="btn btn-sub">Dang xuat</button></form>
    </div>
    ${geminiOk}${modelSaved}${modelErr}
    ${aiBlock}
    <div class="card">
      <h3 style="margin-top:0">&#x1F4AC; Test Chat truc tiep</h3>
      <div id="messages" class="messages"><div class="msg bot">&#x1F916; San sang test voi model Gemini cua ban.</div></div>
      <form id="chat" style="margin:0">
        <textarea id="prompt" required placeholder="Nhap tin nhan test..." rows="2" style="resize:vertical"></textarea>
        <button id="sbtn" type="submit">Gui tin nhan</button>
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
        btn.textContent = 'Dang xu ly...';
        try {
          const res = await fetch('/u/${id}/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ prompt: v }) });
          const d = await res.json();
          m.innerHTML += '<div class="msg bot">' + (d.reply || d.error || 'Khong co phan hoi').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</div>';
        } catch (err) {
          m.innerHTML += '<div class="msg bot" style="color:#fca5a5">Loi: ' + err.message + '</div>';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Gui tin nhan';
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
  if (!u || !validModel.test(cleanModel) || !updateUserAiModel(u.fbThreadId, cleanModel)) {
    res.redirect(`/u/${id}?modelErr=1`);
    return;
  }
  res.redirect(`/u/${id}?modelSaved=1`);
});
router.post("/u/:id/chat",async(req,res): Promise<void>=>{const u=current(req,req.params.id.toLowerCase());const prompt=String(req.body.prompt??"").trim();if(!u){res.status(401).json({error:"Can dang nhap."});return;}if(!prompt){res.status(400).json({error:"Thieu tin nhan."});return;}try{res.json({reply:await getClaudeReply(u.fbThreadId,prompt,botState.systemPrompt)})}catch{res.status(502).json({error:"AI chua san sang. Hay ket noi Gemini hoac lien he admin."})}});
export default router;
