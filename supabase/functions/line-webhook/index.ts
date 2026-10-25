// ─── line-webhook ──────────────────────────────────────────────
// รับ event จาก LINE OA: เพิ่มเพื่อน / เลิกติดตาม / ข้อความแชท
//   "ผูก <เลขมิเตอร์> <รหัส 6 หลัก>"  → ผูกบัญชี LINE กับผู้ใช้น้ำ (รหัสอยู่บนใบแจ้งค่าน้ำ)
//   "บิล" / "ยอด"                       → ตอบยอดค้างชำระ
//   "ยกเลิกการผูก"                      → ยกเลิกการรับแจ้งเตือน
// ตรวจลายเซ็น x-line-signature ทุกครั้ง
//
// env: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, PORTAL_URL
// deploy: npx supabase functions deploy line-webhook --no-verify-jwt
// ──────────────────────────────────────────────────────────────
import { env, rpc, lineApi, json, safeEqual, baht, thaiDate, portalLink } from '../_shared/common.ts';

async function validSignature(body: string, signature: string): Promise<boolean> {
  const secret = env('LINE_CHANNEL_SECRET');
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return safeEqual(btoa(String.fromCharCode(...mac)), signature);
}

const HELP =
  'ระบบแจ้งค่าน้ำประปาหมู่บ้าน\n\n' +
  'ผูกบัญชีเพื่อรับใบแจ้งค่าน้ำทาง LINE พิมพ์:\nผูก <เลขมิเตอร์> <รหัส 6 หลัก>\nเช่น  ผูก WM-0012 AB12CD\n' +
  '(รหัสอยู่บนใบแจ้งค่าน้ำ)\n\nพิมพ์ "บิล" เพื่อดูยอดค้างชำระ';

const reply = (replyToken: string, text: string) =>
  lineApi('/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text }] });

async function handleText(userId: string, text: string): Promise<string> {
  const t = text.trim();
  const link = t.match(/^(?:ผูก|link)\s+(\S+)\s+(\S+)$/i);
  if (link) {
    const r = await rpc<{ error?: string; member?: { name: string; meter_no: string } }>(
      'line_link_member', { p_line_user_id: userId, p_meter: link[1], p_code: link[2] });
    return r.error ? `ผูกบัญชีไม่สำเร็จ: ${r.error}`
      : `ผูกบัญชีเรียบร้อย ✅\n${r.member!.name} (มิเตอร์ ${r.member!.meter_no})\nต่อไปจะได้รับใบแจ้งค่าน้ำและการแจ้งเตือนทาง LINE`;
  }
  if (/^ยกเลิกการผูก$/.test(t)) {
    await rpc('line_unlink', { p_line_user_id: userId });
    return 'ยกเลิกการผูกบัญชีแล้ว จะไม่ได้รับแจ้งเตือนทาง LINE อีก';
  }
  if (/^(บิล|ยอด|ค้าง|ค่าน้ำ)/.test(t)) {
    const s = await rpc<any>('line_member_summary', { p_line_user_id: userId });
    if (!s) return 'ยังไม่ได้ผูกบัญชี\n\n' + HELP;
    if (!s.unpaid?.length) return `${s.name} (มิเตอร์ ${s.meter_no})\nไม่มียอดค้างชำระ ขอบคุณครับ/ค่ะ 🙏`;
    const total = s.unpaid.reduce((a: number, b: any) => a + Number(b.total), 0);
    const lines = s.unpaid.map((b: any) => `• ${b.period} ${baht(b.total)} (ครบกำหนด ${thaiDate(b.due_date)})`).join('\n');
    const url = portalLink();
    return `${s.name} (มิเตอร์ ${s.meter_no})\nยอดค้างชำระ:\n${lines}\nรวม ${baht(total)}` +
      // ไม่ส่งรหัส portal ทางแชท — ถ้า LINE ถูกผูกโดยคนอื่น รหัสใหม่จะไม่หลุดตาม
      (url ? `\n\nจ่ายด้วย QR: ${url}\n(รหัสเข้าดูบิลอยู่บนใบแจ้งค่าน้ำ หรือสอบถามเจ้าหน้าที่)` : '');
  }
  return HELP;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });   // LINE ตรวจ URL ด้วย GET/POST ว่าง
  const body = await req.text();
  if (!(await validSignature(body, req.headers.get('x-line-signature') ?? ''))) return json({ error: 'bad signature' }, 401);

  const { events = [] } = JSON.parse(body || '{}');
  for (const ev of events) {
    const userId = ev.source?.userId;
    if (!userId) continue;
    try {
      if (ev.type === 'follow') await reply(ev.replyToken, 'ขอบคุณที่เพิ่มเพื่อน 🙏\n\n' + HELP);
      else if (ev.type === 'unfollow') await rpc('line_unlink', { p_line_user_id: userId });
      else if (ev.type === 'message' && ev.message?.type === 'text') await reply(ev.replyToken, await handleText(userId, ev.message.text));
    } catch (e) {
      console.error('[line-webhook]', ev.type, e);
    }
  }
  return json({ ok: true });   // ตอบ 200 เสมอ ไม่งั้น LINE จะส่งซ้ำ
});
