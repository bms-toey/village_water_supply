# ISO/IEC 27001:2022 Readiness Audit — AquaFlow Pro

วันที่ประเมิน: 23 พฤศจิกายน 2026 (Asia/Bangkok)

ขอบเขตทางเทคนิค: repository, static PWA, Supabase schema/RLS/RPC, Edge Functions, PWA cache, deployment guidance

มาตรฐานอ้างอิง: ISO/IEC 27001:2022, ISO/IEC 27002:2022 และ ISO/IEC 27001:2022/Amd 1:2024

## ข้อสรุป

สถานะ: **ยังไม่พร้อมยื่นรับรอง** แต่มีฐานควบคุมทางเทคนิคระดับดี

เหตุผลหลักไม่ใช่ช่องโหว่เดียว แต่เป็นหลักฐาน ISMS ระดับองค์กรที่ยังไม่มีหรือยังไม่ได้อนุมัติ ได้แก่ ขอบเขต ISMS, ผู้รับผิดชอบ, risk acceptance, Statement of Applicability ที่ลงนาม, supplier/DPA, การทดสอบกู้คืน, การซ้อม incident, internal audit และ management review

repository นี้ได้รับการเพิ่ม baseline evidence, risk register, SoA, operating procedures, security policy และ CI security gate แล้ว เอกสารทั้งหมดต้องได้รับการแต่งตั้ง owner, อนุมัติ และมีหลักฐานการปฏิบัติจริงก่อน Stage 1 audit

## วิธีตรวจ

- ตรวจไฟล์ทั้งหมด 139 ไฟล์ โดยไม่รวม `.git` และ `node_modules`
- ตรวจ authentication/session, local/offline storage, CSP/SRI, remote dependencies, SQL privileges/RLS, audit, retention, backup และ Edge Functions
- ตรวจ anonymous REST access แบบอ่านอย่างเดียวต่อ `members`, `profiles`, `audit_logs`, `system_config`, `member_access`
- ตรวจโครงสร้างเอกสาร, CI, test gate และประวัติ Git
- ไม่ได้ใช้สิทธิ์ database admin จึงยังยืนยัน migration ที่ติดตั้งจริง, Vault, PITR, cron, Storage policy และ log chain ใน production ไม่ได้

## ผลที่ยืนยันได้

| ประเด็น | ผล | หลักฐาน |
|---|---|---|
| Anonymous access ต่อข้อมูลสำคัญ | ผ่านในการทดสอบ — ทั้ง 5 resource ตอบ 401 | ผลตรวจวันที่ 23 พ.ย. 2026; ต้องเก็บ log/screenshot ใน evidence store |
| RLS/RPC/role guard | มี implementation และตัวตรวจติดตั้ง | `sql/sql_phase5_security.sql`, `sql/verify_install.sql` |
| Password/session | bcrypt cost 12, policy, lockout, revocation, expiry | `sql/sql_phase5_security.sql`, `src/services/auth.service.js` |
| Privileged/PII data | encrypted national ID, masking, server-side audit | `sql/sql_phase5_security.sql`, `docs/SECURITY_PDPA.md` |
| Audit integrity | immutable audit + hash chain verification | `verify_audit_chain` ใน phase 5 |
| Supply-chain browser assets | ระบุ version และ SRI สำหรับ script/stylesheet หลัก | `index.html`, `portal.html` |
| Local data retention | เพิ่ม TTL 12 ชั่วโมงและล้างเมื่อ logout/idle | `src/services/storage.service.js` |
| Inactivity protection | เพิ่ม lock/logout หลังไม่ใช้งาน 15 นาที | `src/services/auth.service.js` |
| Secure change gate | เพิ่ม automated repository check และ CI | `scripts/security-check.mjs`, `.github/workflows/security-check.yml` |

## ช่องว่างที่ต้องปิดก่อนยื่นรับรอง

### ระดับสูง

1. **ISMS governance ยังไม่อนุมัติ** — กำหนด scope, interested parties, owner, risk criteria, objectives, document control และ management review
2. **ยังไม่มี MFA สำหรับ privileged roles** — super_admin/finance ควรใช้ phishing-resistant MFA หรือย้าย authentication ไป provider ที่บังคับ MFA ได้
3. **ยังไม่มีหลักฐาน backup/restore** — เปิด PITR, ระบุ RPO/RTO, ทดสอบ restore แยก environment และเก็บผลอย่างน้อยรายไตรมาส
4. **production headers ยังไม่ยืนยัน** — hosting ต้องส่ง HSTS, frame-ancestors/X-Frame-Options, nosniff, Referrer-Policy และ Permissions-Policy จริง ไม่ใช่เฉพาะ meta CSP
5. **supplier/privacy contracts** — ต้องทำ DPA และประเมิน Supabase, LINE, ThaiBulkSMS, OpenRouter รวมถึงประเทศที่ประมวลผลและ retention
6. **endpoint/offline data** — offline queue และรูปยังอยู่ในอุปกรณ์จนกว่าจะ sync/discard ต้องใช้อุปกรณ์ที่เข้ารหัสทั้งเครื่อง มี screen lock และ remote wipe

### ระดับกลาง

1. CSP ยังใช้ `unsafe-inline` เพราะมี inline handlers; ต้องวางแผนย้ายไป event listeners แล้วตัด directive นี้
2. มี `innerHTML` จำนวนมาก แม้ส่วนใหญ่ใช้ `esc()`; ต้องเพิ่ม security-focused UI tests สำหรับ stored XSS
3. rate limit ของ `meter-ocr` อยู่ใน memory ของ Edge instance จึงไม่ใช่ distributed rate limit
4. โค้ดรุ่นเก่าใน `js/` และ `css/` อยู่ร่วมกับ `src/` และ `styles/`; ต้องยืนยัน dependency แล้ว archive/remove ตาม change control
5. ยังไม่มี SAST/DAST, dependency/SBOM process และ penetration test โดยผู้ประเมินอิสระ
6. ยังไม่มีหลักฐาน branch protection, mandatory review, signed release และ separation of duties

## เกณฑ์ผ่านภายในก่อน Stage 1

- `npm run check` ผ่านโดยไม่มี FAIL
- `sql/verify_install.sql` ทุกแถวเป็น ✅ และเก็บผลที่ลงวันที่
- SoA และ risk register มี owner/approver และไม่มี high risk ที่ไม่มี treatment/acceptance
- ทดสอบ restore ผ่านตาม RPO/RTO, audit hash chain ผ่าน และ incident tabletop เสร็จ
- ตรวจ header จาก production URL ผ่าน
- access review, supplier review, training และ management review มีบันทึก
- ประเด็น Amendment 1:2024 ถูกพิจารณาใน context/risk review แม้สรุปว่าไม่ material ก็ต้องมีเหตุผลและผู้อนุมัติ

## คำวินิจฉัย

คำว่า “ผ่าน ISO” ใช้ได้เมื่อองค์กรผ่านการตรวจของ certification body เท่านั้น ผลนี้คือ **readiness assessment ทางเทคนิค** และรายการหลักฐานที่ต้องปิด ไม่ใช่ใบรับรองหรือคำรับรองทางกฎหมาย
