// ─── Member Self-service Portal ────────────────────────────────────────────
// Allows members (or staff) to look up bills by phone number or meter number.
// No Supabase write — read-only view of appState data.
import { appState } from '../../state/app.state.js';
import { esc } from '../../utils/dom.util.js';

const billStatusLabel = {
  paid:      { label: 'ชำระแล้ว',  cls: 'pill-paid'    },
  overdue:   { label: 'ค้างชำระ',  cls: 'pill-overdue' },
  pending:   { label: 'รอยืนยัน', cls: 'pill-pending'  },
  cancelled: { label: 'ยกเลิก',    cls: 'pill-closed'  },
};

export function portalSearch() {
  const input   = document.getElementById('portal-search-input');
  const result  = document.getElementById('portal-result');
  if (!input || !result) return;

  const q = input.value.trim().toLowerCase();
  if (!q) { result.style.display = 'none'; return; }

  const { members, bills, payments } = appState;

  const member = members.find(m =>
    (m.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
    m.meter.toLowerCase() === q ||
    m.meter.toLowerCase().includes(q)
  );

  if (!member) {
    result.style.display = 'block';
    result.innerHTML = `
      <div class="card" style="padding:32px;text-align:center;color:var(--gray-500)">
        <i class="ti ti-user-off" style="font-size:36px;display:block;margin-bottom:8px;color:var(--gray-300)"></i>
        <div style="font-size:14px;font-weight:600">ไม่พบข้อมูลสมาชิก</div>
        <div style="font-size:12px;margin-top:4px">ลองค้นหาด้วยเบอร์โทรหรือเลขมิเตอร์</div>
      </div>`;
    return;
  }

  const memberBills = bills
    .filter(b => b.memberId === member.id)
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, 12);

  const outstanding = memberBills
    .filter(b => b.status === 'overdue' || b.status === 'pending')
    .reduce((s, b) => s + b.total, 0);

  const lastPay = payments
    .filter(p => p.memberId === member.id && p.status === 'approved')
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];

  const stInfo = { normal: { label: 'ปกติ', color: 'var(--green-700)' }, overdue: { label: 'ค้างชำระ', color: 'var(--red-600)' }, closed: { label: 'ปิดมิเตอร์', color: 'var(--gray-500)' } };
  const mSt = stInfo[member.status] || stInfo.normal;

  result.style.display = 'block';
  result.innerHTML = `
    <!-- Member summary card -->
    <div class="card" style="margin-bottom:16px">
      <div style="padding:20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;border-bottom:1px solid var(--gray-100)">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--blue-100);color:var(--blue-700);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;flex-shrink:0">
          ${esc((member.firstName||'?')[0])}
        </div>
        <div style="flex:1;min-width:160px">
          <div style="font-size:16px;font-weight:700;color:var(--blue-900)">${esc(member.firstName)} ${esc(member.lastName)}</div>
          <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${esc(member.houseNo||'')} ${esc(member.village||'')} · มิเตอร์ ${esc(member.meter)}</div>
          <div style="margin-top:6px"><span style="font-size:12px;font-weight:600;color:${mSt.color}">${mSt.label}</span></div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:800;color:${outstanding>0?'var(--red-600)':'var(--green-700)'}">฿${outstanding.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--gray-500)">ยอดค้างชำระ</div>
          </div>
          ${lastPay ? `<div style="text-align:center">
            <div style="font-size:13px;font-weight:700;color:var(--blue-800)">฿${lastPay.amount.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--gray-500)">ชำระล่าสุด ${lastPay.paidAt.substring(0,10)}</div>
          </div>` : ''}
        </div>
      </div>

      <!-- Bill list -->
      <div style="padding:16px 20px 4px">
        <div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:12px">ประวัติบิล (${memberBills.length} รายการล่าสุด)</div>
        ${memberBills.length ? `
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>เลขบิล</th><th>รอบ</th>
              <th style="text-align:right">ยอด (บาท)</th>
              <th>สถานะ</th>
              <th>ชำระวันที่</th>
            </tr></thead>
            <tbody>
              ${memberBills.map(b => {
                const st = billStatusLabel[b.status] || billStatusLabel.pending;
                const pay = payments.find(p => p.billId === b.id && p.status === 'approved');
                const paidDate = pay ? pay.paidAt.substring(0, 10) : '—';
                return `<tr>
                  <td style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--gray-600)">${esc(b.id)}</td>
                  <td style="font-size:12.5px">${esc(b.period)}</td>
                  <td style="text-align:right;font-weight:700;font-size:13px;color:${b.status==='overdue'?'var(--red-700)':'var(--gray-800)'}">฿${b.total.toLocaleString()}</td>
                  <td><span class="pill ${st.cls}" style="font-size:11px">${st.label}</span></td>
                  <td style="font-size:12px;color:var(--gray-500)">${paidDate}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : `<div style="text-align:center;color:var(--gray-400);padding:24px;font-size:13px">ยังไม่มีบิล</div>`}
      </div>
    </div>`;
}
