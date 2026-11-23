# Information Security Risk Register

เกณฑ์เริ่มต้น: Likelihood (L) และ Impact (I) 1–5, คะแนน = L×I; 1–4 Low, 5–9 Medium, 10–15 High, 16–25 Critical

ผู้บริหารต้องอนุมัติเกณฑ์ เจ้าของความเสี่ยง และ residual risk; ค่าในตารางเป็นข้อเสนอเริ่มต้น

| ID | Asset/process | Threat / vulnerability | C/I/A | L | I | Inherent | Existing controls | Treatment / evidence needed | Residual target | Owner | Status |
|---|---|---|:---:|---:|---:|---:|---|---|---:|---|---|
| R-01 | Supabase secrets | service-role/JWT/PII key รั่วจาก source หรือเครื่องผู้ดูแล | C/I | 3 | 5 | 15 H | Vault/Edge secrets, secret scan | rotation drill, dual custody, access log review | 5 M | ISMS owner | Open |
| R-02 | Staff accounts | privileged account ถูกยึดเพราะไม่มี MFA | C/I | 4 | 5 | 20 C | bcrypt, lockout, session revoke | บังคับ MFA สำหรับ admin/finance | 8 M | System owner | Open |
| R-03 | Member/finance cache | PII/ข้อมูลเงินถูกอ่านจากอุปกรณ์ที่หายหรือใช้ร่วมกัน | C | 3 | 5 | 15 H | 12h TTL, logout/idle purge, privacy mode | managed-device encryption, screen lock, remote wipe | 6 M | Operations | Open |
| R-04 | Offline queue/photos | คิวและภาพค้างใน localStorage/IndexedDB | C/I | 3 | 4 | 12 H | ผูก profile, sync conflict check | retention purge, encrypted endpoint, lost-device process | 6 M | Field lead | Open |
| R-05 | Web UI | stored/reflected XSS ขโมย session token | C/I | 3 | 5 | 15 H | escaping helpers, CSP, SRI | remove inline handlers, UI security tests, penetration test | 6 M | Development | Open |
| R-06 | Database authorization | migration/RLS production ไม่ตรง source | C/I | 3 | 5 | 15 H | phase 5 migration, `verify_install.sql`, anon test | run/retain verification every release; drift monitoring | 5 M | Database owner | Open |
| R-07 | Backup/recovery | ข้อมูลสูญหายหรือ restore ไม่ทัน | I/A | 3 | 5 | 15 H | encrypted export, retention guidance | PITR + quarterly restore drill + approved RPO/RTO | 5 M | Service owner | Open |
| R-08 | Suppliers | processor outage/breach/transfer non-compliance | C/A | 3 | 5 | 15 H | named suppliers, limited secrets | DPA, due diligence, exit plan, annual review | 6 M | Procurement/DPO | Open |
| R-09 | Audit/logging | เหตุผิดปกติไม่ถูกแจ้งเตือนทันเวลา | C/I/A | 3 | 4 | 12 H | immutable hash-chained audit | alert rules, log review SLA, SIEM/export | 6 M | Security owner | Open |
| R-10 | Deployment | production ไม่มี security headers/TLS policy | C/I | 3 | 4 | 12 H | meta CSP and frame guard | validate headers each deploy; HSTS/reverse proxy | 4 L | Platform owner | Open |
| R-11 | Edge OCR | รูปมิเตอร์ส่งไป external AI เกินวัตถุประสงค์ | C/P | 3 | 4 | 12 H | auth, size/type checks, secret isolation | DPIA/DPA, user notice, retention guarantee, opt-out | 6 M | DPO/Product | Open |
| R-12 | Secure development | defect/security regression เข้า production | C/I/A | 3 | 4 | 12 H | Git history, CI gate, SRI | branch protection, review, SAST/DAST, release approval | 5 M | Development lead | Open |
| R-13 | Availability | Supabase/CDN/Internet outage หยุดรับชำระ/จดมิเตอร์ | A/I | 3 | 4 | 12 H | PWA cache, offline meter queue | BCP, manual forms, reconciliation test, status contacts | 6 M | Operations | Open |
| R-14 | Insider misuse | เจ้าหน้าที่ดู/ส่งออกข้อมูลเกินหน้าที่ | C | 3 | 5 | 15 H | roles, masking, export audit | village scoping, quarterly access review, sanctions/training | 5 M | HR/System owner | Open |
| R-15 | Retention | รูป/สลิป/PII ถูกเก็บนานเกินจำเป็น | C/P | 3 | 4 | 12 H | DB retention job, anonymisation | storage lifecycle deletion and deletion evidence | 4 L | DPO | Open |
| R-16 | Climate/disruption | น้ำท่วม ไฟฟ้าดับ ความร้อน หรือโครงข่ายเสียหายกระทบงาน/อุปกรณ์ | A/I | 2 | 4 | 8 M | cloud service, offline workflow | document relevance, alternate site/power/connectivity test | 4 L | Management | Open |

## การจัดการ

- ทบทวนทุกไตรมาสและเมื่อมี incident, supplier/change สำคัญ หรือ threat ใหม่
- Critical/High ห้ามรับความเสี่ยงโดยผู้พัฒนาคนเดียว ต้องมี business owner และ ISMS owner อนุมัติ
- treatment ต้องมี due date, evidence link และผู้ตรวจผล; เปลี่ยนสถานะเป็น Closed ได้เมื่อ residual risk ได้รับอนุมัติ
