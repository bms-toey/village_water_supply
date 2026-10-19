// ─── ข้อความที่ส่งถึงผู้ใช้น้ำ (LINE + SMS) ──────────────────────
import { baht, thaiDate, portalLink } from './common.ts';

type Payload = Record<string, any>;
type LineMessage = Record<string, unknown>;

const linkButton = (label = 'ดูบิล / จ่ายด้วย QR') => {
  const uri = portalLink();
  return uri ? [{ type: 'button', style: 'primary', color: '#1d4ed8', action: { type: 'uri', label, uri } }] : [];
};

function billBubble(title: string, color: string, p: Payload, note: string): LineMessage {
  const row = (k: string, v: string, bold = false) => ({
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: k, size: 'sm', color: '#6b7280', flex: 4 },
      { type: 'text', text: v, size: 'sm', align: 'end', flex: 6, weight: bold ? 'bold' : 'regular', wrap: true },
    ],
  });
  return {
    type: 'flex',
    altText: `${title} ${p.period ?? ''} ${baht(p.total)}`,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px',
        contents: [{ type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'md' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        row('รอบบิล', String(p.period ?? '-')),
        row('ใช้น้ำ', `${Number(p.usage || 0)} ลบ.ม.`),
        row('ครบกำหนด', thaiDate(p.due_date)),
        { type: 'separator', margin: 'md' },
        row('ยอดชำระ', baht(p.total), true),
        { type: 'text', text: note, size: 'xs', color: '#6b7280', wrap: true, margin: 'md' },
      ] },
      ...(linkButton().length ? { footer: { type: 'box', layout: 'vertical', contents: linkButton() } } : {}),
    },
  };
}

/** ข้อความ LINE ตามประเภท */
export function lineMessages(kind: string, p: Payload): LineMessage[] {
  switch (kind) {
    case 'bill_issued':
      return [billBubble('ใบแจ้งค่าน้ำประปา', '#1d4ed8', p, 'ชำระได้ที่เจ้าหน้าที่ หรือสแกน QR พร้อมเพย์ในหน้าบิล')];
    case 'due_soon':
      return [billBubble('ใกล้ครบกำหนดชำระ', '#d97706', p, 'อีก 3 วันจะครบกำหนด กรุณาชำระเพื่อหลีกเลี่ยงค่าปรับ')];
    case 'overdue':
      return [billBubble('เลยกำหนดชำระ', '#dc2626', p, 'มีค่าปรับชำระล่าช้า กรุณาชำระโดยเร็ว')];
    case 'overdue_reminder':
      return [{ type: 'text', text:
        `แจ้งเตือนค่าน้ำค้างชำระ ${p.count} งวด (${p.periods})\nรวม ${baht(p.total)}\n` +
        `กรุณาชำระโดยเร็ว หากค้างเกินกำหนดอาจถูกงดจ่ายน้ำชั่วคราว` + (portalLink() ? `\n\nดูบิล/จ่ายด้วย QR: ${portalLink()}` : '') }];
    case 'payment_received':
      return [{ type: 'text', text:
        `ได้รับชำระค่าน้ำเรียบร้อย ${baht(p.amount)}\nใบเสร็จเลขที่ ${p.receipt_no ?? '-'}\nบิล ${p.bill_id}\nขอบคุณครับ/ค่ะ` }];
    case 'announcement':
      return [{ type: 'text', text: `📢 ${p.title}\n\n${p.message}` }];
    default:
      return [{ type: 'text', text: String(p.message ?? p.title ?? kind) }];
  }
}

/** ข้อความ SMS (สั้น, ไม่เกิน ~2 ข้อความ) */
export function smsText(kind: string, p: Payload): string {
  switch (kind) {
    case 'bill_issued':      return `ค่าน้ำ ${p.period} ${baht(p.total)} ครบกำหนด ${thaiDate(p.due_date)}`;
    case 'due_soon':         return `ค่าน้ำ ${p.period} ${baht(p.total)} จะครบกำหนด ${thaiDate(p.due_date)}`;
    case 'overdue':          return `ค่าน้ำ ${p.period} ${baht(p.total)} เลยกำหนดแล้ว กรุณาชำระ`;
    case 'overdue_reminder': return `ค้างค่าน้ำ ${p.count} งวด รวม ${baht(p.total)} กรุณาชำระโดยเร็ว`;
    case 'payment_received': return `รับชำระค่าน้ำ ${baht(p.amount)} ใบเสร็จ ${p.receipt_no ?? '-'} ขอบคุณ`;
    case 'announcement':     return `${p.title}: ${p.message}`.slice(0, 140);
    default:                 return String(p.message ?? kind).slice(0, 140);
  }
}
