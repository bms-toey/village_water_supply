// ─── Shared helpers for AquaFlow Edge Functions ────────────────
// เรียก RPC ในฐานข้อมูลด้วย service role + เรียก LINE Messaging API
// ──────────────────────────────────────────────────────────────

export const env = (k: string, d = '') => Deno.env.get(k) ?? d;

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
const LINE_API     = env('LINE_API_BASE', 'https://api.line.me').replace(/\/$/, '');
const LINE_TOKEN   = env('LINE_CHANNEL_ACCESS_TOKEN');

/** เรียก public.<fn>() ด้วยสิทธิ์ service_role */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: SERVICE_KEY };
  if (SERVICE_KEY.startsWith('eyJ')) headers.authorization = `Bearer ${SERVICE_KEY}`;   // legacy JWT key
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function lineApi(path: string, body: unknown, retryKey?: string): Promise<void> {
  if (!LINE_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` };
  if (retryKey) headers['x-line-retry-key'] = retryKey;   // LINE ไม่ส่งซ้ำถ้า retry ด้วย key เดิม
  const res = await fetch(`${LINE_API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  // 409 = เคยส่งด้วย retry key นี้แล้ว → ถือว่าสำเร็จ
  if (!res.ok && res.status !== 409) throw new Error(`LINE ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** เปรียบเทียบแบบเวลาคงที่ (กัน timing attack) */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** UUID คงที่จากข้อความ — ใช้เป็น X-Line-Retry-Key ของ outbox แต่ละรายการ */
export async function stableUuid(seed: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thaiDate(iso?: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return y ? `${d} ${TH_MONTHS[m - 1]} ${y + 543}` : String(iso);
}
export const baht = (n: unknown) =>
  '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function portalLink(): string {
  return env('PORTAL_URL');   // เช่น https://example.github.io/village_water_supply/portal.html
}
