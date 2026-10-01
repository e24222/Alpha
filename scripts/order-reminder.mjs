// 每天早上 9:00（台灣）執行：把「提醒日 <= 今天」且未寄、未處理的通報，合併成一封信寄給所有收件人。
// 需要環境變數：SUPABASE_ANON_KEY、RESEND_API_KEY、RESEND_FROM（沒有 RESEND_API_KEY 時只檢查不寄信）
const SUPA = 'https://achrezfjtyjjgoyaaowr.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const RESEND = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台灣日期
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = async p => { const r = await fetch(`${SUPA}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };

const due = await get(`order_notes?done=eq.false&reminded_at=is.null&remind_on=lte.${today}&order=created_at`);
const rcpt = (await get('order_note_recipients')).map(r => r.email);
console.log(`${today}: 到期提醒 ${due.length} 筆，收件人 ${rcpt.length} 位`);
if (!due.length) process.exit(0);
if (!rcpt.length) { console.log('沒有設定收件人，略過'); process.exit(0); }
if (!RESEND) { console.log('未設定 RESEND_API_KEY，略過寄信'); process.exit(0); }

const body = due.map(o => {
  const rows = (o.items || []).map(i => `<tr><td>${esc(i.due)}</td><td>${esc(i.part)}</td><td>${esc(i.name)}</td><td>${esc(i.qty)}</td></tr>`).join('');
  return `<div style="margin-bottom:20px"><b>${esc(o.company)} ${esc(o.cust_id)}　${esc(o.cust_name)}</b>
    <span style="color:#64748b">（${esc(o.poster)} 於 ${o.created_at.slice(0, 10)} 通報）</span>
    <table border="1" cellpadding="5" style="border-collapse:collapse;margin:6px 0"><tr><th>預交日期</th><th>貨號</th><th>品名</th><th>數量</th></tr>${rows}</table>
    <div style="background:#fffbeb;padding:6px 10px;white-space:pre-wrap">${esc(o.note)}</div></div>`;
}).join('');

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: FROM, to: rcpt, subject: `【訂單狀況提醒】${due.length} 筆待處理`, html: `<p>以下通報尚未標記「已處理」：</p>${body}` })
});
if (!res.ok) { console.error('寄信失敗', res.status, await res.text()); process.exit(1); }

for (const o of due) {
  await fetch(`${SUPA}/rest/v1/order_notes?id=eq.${o.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ reminded_at: new Date().toISOString() }) });
}
console.log('已寄出');
