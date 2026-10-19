// ─── Print Engine ─────────────────────────────────────────────
// พิมพ์เอกสาร HTML ตามขนาดกระดาษ:
//   thermal58 / thermal80 — เครื่องพิมพ์ใบเสร็จแบบม้วน (ต่อเนื่อง มีเส้นตัด)
//   a5                    — 1 ฉบับต่อหน้า A5
//   a4                    — ใบแจ้ง/ใบเสร็จ 2 ฉบับต่อ A4 แนวนอน (ตัดครึ่งได้ขนาด A5)
//   letter                — หนังสือ/รายงาน A4 แนวตั้ง (ไม่ขึ้นกับการตั้งค่ากระดาษ)
//
// เดสก์ท็อป/Android: พิมพ์ผ่าน iframe ที่ซ่อนไว้ (ไม่มีหน้าต่างใหม่)
// iPhone/iPad: Safari พิมพ์ iframe ไม่เสถียร → เปิดแท็บใหม่ (ต้องเปิดทันทีตอนกดปุ่ม)
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc } from '../../utils/dom.util.js';

export const PAPERS = {
  a4:        'A4 (2 ใบต่อแผ่น)',
  a5:        'A5',
  thermal80: 'เครื่องพิมพ์ใบเสร็จ 80 มม.',
  thermal58: 'เครื่องพิมพ์ใบเสร็จ 58 มม.',
};

const PAPER_KEY = 'aq_print_paper';

/** กระดาษที่เครื่องนี้ใช้ (แต่ละเครื่องต่อเครื่องพิมพ์ต่างกัน) → ค่าเริ่มต้นของระบบ → A4 */
export function getPaper() {
  let p = null;
  try { p = localStorage.getItem(PAPER_KEY); } catch { /* storage blocked */ }
  p = p || appState.systemConfig?.print_paper;
  return PAPERS[p] ? p : 'a4';
}

export function setPaper(p) {
  if (!PAPERS[p]) return;
  try { localStorage.setItem(PAPER_KEY, p); } catch { /* storage blocked */ }
}

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono{font-family:'IBM Plex Mono',monospace}
.num{text-align:right;white-space:nowrap}.center{text-align:center}.right{text-align:right}
.doc{position:relative;overflow:hidden}
.doc-hd{text-align:center;margin-bottom:3mm}
.org-name{font-weight:800;font-size:1.25em}
.org-sub{font-size:.85em;color:#444}
.doc-title{font-weight:800;font-size:1.15em;margin-top:1.5mm;letter-spacing:.3px}
.doc-subtitle{font-size:.9em;margin-top:.5mm}
.badge{display:inline-block;border:1.5px solid #111;border-radius:3px;padding:0 2mm;font-weight:700;font-size:.85em}
.badge-copy{border-style:dashed}
table{width:100%;border-collapse:collapse}
.kv th{text-align:left;font-weight:600;color:#444;white-space:nowrap;padding:.5mm 1.5mm .5mm 0;width:1%}
.kv td{padding:.5mm 2mm .5mm 0}
.box{border:1px solid #bbb;border-radius:2mm;padding:1.5mm 2.5mm;margin:2mm 0}
.box.warn{border-color:#c00;color:#900}
.member-name{font-weight:700;font-size:1.05em}
.meter{margin:2mm 0;text-align:center}
.meter td{border:1px solid #ccc;padding:1mm}
.meter .lbl{font-size:.75em;color:#555}.meter .val{font-weight:700;font-size:1.1em}
.lines td{padding:.8mm 0;border-bottom:1px dotted #bbb;vertical-align:top}
.lines .total td{font-weight:800;font-size:1.1em;border-top:1.5px solid #111;border-bottom:3px double #111}
.lines.bordered td{border:1px solid #999;padding:1mm 1.5mm}
.lines .head td{font-weight:700;background:#f0f0f0}
.words{text-align:right;font-size:.85em;margin:1mm 0 2mm}
.pay{display:flex;gap:3mm;align-items:center;margin:2mm 0;border:1px solid #bbb;border-radius:2mm;padding:2mm}
.qr{text-align:center}.qr svg{width:34mm;height:34mm;display:block;margin:0 auto}
.qr-cap{font-size:.8em;line-height:1.3}
.bank{font-size:.85em;line-height:1.4}
.note{font-size:.78em;color:#444;margin-top:1.5mm;text-align:center}
.sign{margin-top:6mm;text-align:center;font-size:.9em}
.sign-line{border-bottom:1px dotted #111;width:55%;margin:0 auto 1mm;height:8mm}
.watermark{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:4em;font-weight:900;
  color:rgba(200,0,0,.18);border:6px solid rgba(200,0,0,.18);padding:0 6mm;border-radius:4mm;pointer-events:none;white-space:nowrap}
/* ── letters (A4 portrait) ── */
.letter{font-size:15px;line-height:1.65}
.letter p{margin:2.5mm 0}.letter .indent{text-indent:12mm}
.letter .doc-hd{margin-bottom:5mm}
.letter-meta td{padding:0}
.right-sign{margin-left:45%;text-align:center}
.right-sign .sign-line{width:80%}
.signs{margin-top:12mm;text-align:center}.signs td{width:33%;padding:0 3mm}.signs .sign-line{width:85%}
.summary{margin-top:3mm}
`;

const PAPER_CSS = {
  thermal58: `@page{size:58mm auto;margin:2mm}body{width:54mm;font-size:10px}
    .doc+.doc{border-top:1px dashed #000;margin-top:5mm;padding-top:4mm}
    .pay{flex-direction:column}.qr svg{width:30mm;height:30mm}.kv th,.kv td{display:block;width:auto}
    .meter .val{font-size:1em}.watermark{font-size:2.4em}`,
  thermal80: `@page{size:80mm auto;margin:3mm}body{width:74mm;font-size:11px}
    .doc+.doc{border-top:1px dashed #000;margin-top:6mm;padding-top:4mm}
    .pay{flex-direction:column}.watermark{font-size:3em}`,
  a5: `@page{size:A5 portrait;margin:8mm}body{font-size:12.5px}
    .doc{page-break-after:always;break-after:page;min-height:190mm}.doc:last-child{page-break-after:auto;break-after:auto}`,
  a4: `@page{size:A4 landscape;margin:7mm}body{font-size:12px}
    .sheet{display:grid;grid-template-columns:1fr 1fr;column-gap:14mm;height:195mm;page-break-after:always;break-after:page;position:relative}
    .sheet:last-child{page-break-after:auto;break-after:auto}
    .sheet::after{content:'';position:absolute;top:0;bottom:0;left:50%;border-left:1px dashed #999}
    .sheet .doc{height:195mm}`,
  letter: `@page{size:A4 portrait;margin:16mm 18mm}
    .doc{page-break-after:always;break-after:page}.doc:last-child{page-break-after:auto;break-after:auto}`,
};

function buildHtml(title, docs, layout) {
  const body = layout === 'a4'
    ? Array.from({ length: Math.ceil(docs.length / 2) }, (_, i) => `<div class="sheet">${docs[i * 2]}${docs[i * 2 + 1] || ''}</div>`).join('')
    : docs.join('');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${BASE_CSS}${PAPER_CSS[layout] || PAPER_CSS.a5}</style></head>
<body class="paper-${layout}">${body}</body></html>`;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * เริ่มงานพิมพ์ — เรียก *ทันที* ตอนผู้ใช้กดปุ่ม (ก่อน await ใดๆ) เพราะ iOS ต้องเปิดแท็บใหม่ใน user gesture
 * @returns {{ print(docs: string[], layout: string): Promise<void>, cancel(): void }}
 */
export function beginPrint(title = 'เอกสาร') {
  const popup = isIOS() ? window.open('', '_blank') : null;
  return {
    async print(docs, layout) {
      if (!docs.length) { popup?.close(); return; }
      const html = buildHtml(title, docs, layout);
      if (typeof window.__aquaflowPrintHook === 'function') {   // ใช้ตอนทดสอบอัตโนมัติ
        popup?.close();
        window.__aquaflowPrintHook({ title, layout, count: docs.length, html });
        return;
      }
      if (popup) { await _printInWindow(popup, html); return; }
      await _printInIframe(html);
    },
    cancel() { popup?.close(); },
  };
}

async function _waitReady(doc) {
  const fonts = doc.fonts?.ready ?? Promise.resolve();
  await Promise.race([fonts, new Promise(r => setTimeout(r, 2500))]);
  await new Promise(r => setTimeout(r, 150));
}

async function _printInIframe(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write(html); doc.close();
  await _waitReady(doc);
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.isConnected && frame.remove(), 60000);
}

async function _printInWindow(win, html) {
  win.document.open(); win.document.write(html); win.document.close();
  await _waitReady(win.document);
  win.focus();
  win.print();
}
