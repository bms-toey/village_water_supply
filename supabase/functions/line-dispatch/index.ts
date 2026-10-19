// ─── line-dispatch ─────────────────────────────────────────────
// ส่งข้อความในคิว notification_outbox ออกไปทาง LINE / SMS
// เรียกโดย pg_cron ทุกนาที (ดู sql_phase2_notify.sql ส่วนที่ 6) ต้องแนบ header x-dispatch-secret
//
// env: LINE_CHANNEL_ACCESS_TOKEN, DISPATCH_SECRET, PORTAL_URL
//      SMS (ไม่บังคับ): SMS_PROVIDER=thaibulksms, THAIBULKSMS_API_KEY, THAIBULKSMS_API_SECRET, SMS_SENDER
// deploy: npx supabase functions deploy line-dispatch --no-verify-jwt
// ──────────────────────────────────────────────────────────────
import { env, rpc, lineApi, json, safeEqual, stableUuid } from '../_shared/common.ts';
import { lineMessages, smsText } from '../_shared/messages.ts';

type OutboxRow = { id: number; channel: 'line' | 'sms'; recipient: string; kind: string; payload: Record<string, unknown> };

async function sendSms(to: string, text: string): Promise<void> {
  if (env('SMS_PROVIDER') !== 'thaibulksms') throw new Error('SMS not configured');
  const auth = btoa(`${env('THAIBULKSMS_API_KEY')}:${env('THAIBULKSMS_API_SECRET')}`);
  const res = await fetch(env('SMS_API_BASE', 'https://api-v2.thaibulksms.com') + '/sms', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ msisdn: to, message: text, sender: env('SMS_SENDER', 'SMS') }),
  });
  if (!res.ok) throw new Error(`SMS ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = env('DISPATCH_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-dispatch-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const rows = await rpc<OutboxRow[]>('outbox_claim', { p_limit: 50 });
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      if (row.channel === 'line') {
        await lineApi('/v2/bot/message/push', { to: row.recipient, messages: lineMessages(row.kind, row.payload) },
                      await stableUuid(`aquaflow-outbox-${row.id}`));
      } else {
        await sendSms(row.recipient, smsText(row.kind, row.payload));
      }
      await rpc('outbox_complete', { p_id: row.id, p_ok: true });
      sent++;
    } catch (e) {
      await rpc('outbox_complete', { p_id: row.id, p_ok: false, p_error: String((e as Error).message ?? e) });
      failed++;
    }
  }
  return json({ claimed: rows.length, sent, failed });
});
