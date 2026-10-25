// ─── meter-ocr ─────────────────────────────────────────────────
// อ่านตัวเลขมิเตอร์น้ำจากรูปด้วย AI (OpenRouter) — API key อยู่ที่ server เท่านั้น
// (เดิมแอปเรียก OpenRouter จากเบราว์เซอร์ → key หลุดไปทุกเครื่องของเจ้าหน้าที่)
//
// POST  { image: "<base64 ของ jpeg/png/webp — มีหรือไม่มี data:...;base64, ก็ได้>", mime?: "image/jpeg" }
// header Authorization: Bearer <token ของเจ้าหน้าที่ที่ login อยู่>
// ตอบ   200 { text: "<ข้อความที่ AI ตอบ>", reading: <ตัวเลข> | null }
//       4xx/5xx { error: "<ข้อความทั่วไป>" }
//
// ตรวจสิทธิ์: เรียก RPC staff_whoami ด้วย token ของผู้เรียก — ต้องเป็นเจ้าหน้าที่ที่บัญชียังใช้งานได้
// จำกัด: รูปไม่เกิน ~4 MB (base64), 30 ครั้ง/นาที/ผู้ใช้ (ต่อ instance)
// ไม่บันทึกรูปหรือ key ลง log
//
// env: OPENROUTER_API_KEY (บังคับ), OPENROUTER_MODEL (ค่าเริ่มต้น qwen/qwen2.5-vl-72b-instruct),
//      ALLOWED_ORIGINS (เช่น https://example.github.io — คั่นด้วย , ; ถ้าไม่ตั้งจะอนุญาตทุก origin)
//      SUPABASE_URL, SUPABASE_ANON_KEY (Supabase ตั้งให้อัตโนมัติ)
// deploy: npx supabase secrets set OPENROUTER_API_KEY=sk-or-... ALLOWED_ORIGINS=https://<โดเมนแอป>
//         npx supabase functions deploy meter-ocr --no-verify-jwt
//         (token ของระบบเซ็นเอง — ตรวจสิทธิ์ใน function ด้วย staff_whoami แทน)
// ──────────────────────────────────────────────────────────────
import { env } from '../_shared/common.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL          = env('OPENROUTER_MODEL', 'qwen/qwen2.5-vl-72b-instruct');
const MAX_B64        = 4 * 1024 * 1024 * 4 / 3;   // ~4 MB ไฟล์จริง
const RATE_LIMIT     = 30;                         // ครั้งต่อนาทีต่อผู้ใช้
const PROMPT         = 'อ่านค่าตัวเลขจากมิเตอร์น้ำในรูปนี้ ตอบเฉพาะตัวเลขที่อ่านได้เท่านั้น ไม่ต้องมีคำอธิบาย หน่วย หรือข้อความอื่นใด';
const MIMES          = new Set(['image/jpeg', 'image/png', 'image/webp']);

const allowed = env('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = !allowed.length ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'vary': 'origin',
  };
}

const reply = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(req) } });

// ── สิทธิ์: token ต้องเป็นเจ้าหน้าที่ที่ยังใช้งานได้ ─────────────────
async function whoami(authHeader: string): Promise<{ id: string; role: string } | null> {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/staff_whoami`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env('SUPABASE_ANON_KEY'), authorization: authHeader },
    body: '{}',
  });
  if (!res.ok) return null;
  const w = await res.json().catch(() => null);
  return w?.role ? { id: String(w.id), role: String(w.role) } : null;
}

// ── จำกัดจำนวนครั้ง (ต่อ instance — กันการยิงรัวจาก token เดียว) ─────
const hits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(userId, list);
  if (hits.size > 1000) for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  return list.length > RATE_LIMIT;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'method not allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(auth)) return reply(req, { error: 'กรุณาเข้าสู่ระบบ' }, 401);
  const user = await whoami(auth).catch(() => null);
  if (!user) return reply(req, { error: 'ไม่มีสิทธิ์ใช้งาน — กรุณาเข้าสู่ระบบใหม่' }, 401);
  if (rateLimited(user.id)) return reply(req, { error: 'ใช้งานถี่เกินไป กรุณารอสักครู่' }, 429);

  const key = env('OPENROUTER_API_KEY');
  if (!key) return reply(req, { error: 'ยังไม่ได้ตั้งค่า AI อ่านมิเตอร์ (ติดต่อผู้ดูแลระบบ)' }, 503);

  let body: { image?: unknown; mime?: unknown };
  try { body = await req.json(); } catch { return reply(req, { error: 'ข้อมูลไม่ถูกต้อง' }, 400); }

  let image = typeof body.image === 'string' ? body.image : '';
  let mime  = typeof body.mime === 'string' && MIMES.has(body.mime) ? body.mime : 'image/jpeg';
  const m = image.match(/^data:(image\/[a-z]+);base64,(.*)$/s);
  if (m) { image = m[2]; if (MIMES.has(m[1])) mime = m[1]; }
  image = image.replace(/\s/g, '');
  if (!image || !/^[A-Za-z0-9+/]+=*$/.test(image)) return reply(req, { error: 'ไม่พบรูปภาพ' }, 400);
  if (image.length > MAX_B64) return reply(req, { error: 'รูปใหญ่เกินไป (ไม่เกิน 4 MB)' }, 413);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${key}`,
        'content-type': 'application/json',
        'HTTP-Referer': req.headers.get('origin') ?? 'https://aquaflow.local',
        'X-Title': 'AquaFlow Meter Reader',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
            { type: 'text', text: PROMPT },
          ],
        }],
        max_tokens: 50,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.error('[meter-ocr] upstream status', res.status);
      return reply(req, { error: 'AI อ่านรูปไม่สำเร็จ กรุณากรอกเอง' }, 502);
    }
    const out = await res.json();
    const text = String(out?.choices?.[0]?.message?.content ?? '').trim().slice(0, 200);
    const digits = text.replace(/\D/g, '');
    return reply(req, { text, reading: digits.length >= 3 ? parseInt(digits, 10) : null });
  } catch (e) {
    console.error('[meter-ocr] error', (e as Error)?.name ?? 'unknown');
    return reply(req, { error: 'AI อ่านรูปไม่สำเร็จ กรุณากรอกเอง' }, 502);
  }
});
