// 每天早上 9:00（台灣）執行：呼叫 Supabase Edge Function，
// 由它把「提醒日 <= 今天」且未寄、未處理的通報合併成一封信，經 Apps Script 用 Gmail 寄給所有收件人。
// 需要環境變數：SUPABASE_ANON_KEY
const SUPA = 'https://achrezfjtyjjgoyaaowr.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;

const res = await fetch(`${SUPA}/functions/v1/send-order-note`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ daily: true }),
});
const text = await res.text();
console.log(res.status, text);
// 沒設收件人不算錯誤；其他失敗讓排程顯示紅燈
if (!res.ok && !text.includes('no recipients')) process.exit(1);
