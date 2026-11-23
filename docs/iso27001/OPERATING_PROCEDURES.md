# ISMS Operating Procedures and Evidence Plan

เอกสารนี้เป็น baseline สำหรับ AquaFlow Pro เจ้าของระบบต้องใส่ชื่อผู้รับผิดชอบ ช่องทางติดต่อ ที่เก็บหลักฐาน และอนุมัติก่อนใช้จริง

## 1. Document control

- เอกสารทุกฉบับมี owner, approver, version, effective date และ review date
- การแก้ control, RLS, authentication, retention หรือ supplier ต้องผ่าน pull request และ change record
- หลักฐาน audit เก็บแบบ read-only ตามระยะเวลาที่หน่วยงานอนุมัติ และห้ามเก็บ secret/PII เกินจำเป็น

## 2. Access lifecycle

1. ผู้บังคับบัญชาร้องขอ role และหมู่บ้านที่จำเป็น พร้อมเหตุผล
2. super_admin คนที่ได้รับมอบหมายสร้างบัญชี; ผู้อนุมัติต้องเป็นคนละคนเมื่อทำได้
3. ผู้ใช้เปลี่ยนรหัสเริ่มต้นและลงทะเบียน MFA เมื่อรองรับ
4. ทบทวนบัญชี privileged รายเดือนและทุกบัญชีรายไตรมาส
5. ปิดบัญชีทันทีเมื่อพ้นหน้าที่; ตรวจ session และ audit event ที่เกี่ยวข้อง
6. เก็บ access-review export, ผู้ทบทวน, ข้อยกเว้น และวันที่แก้ไข

## 3. Secure change and release

1. เปิด issue/change record ที่ระบุ risk, rollback และ test plan
2. ห้าม commit secret หรือ production export
3. รัน `npm run check`; pull request ต้องผ่าน CI และผู้ทบทวนอย่างน้อยหนึ่งคน
4. migration ต้องทดสอบใน non-production และมี backup/rollback
5. หลัง deploy รัน `sql/verify_install.sql`, ตรวจ production headers, login/role smoke test และ audit event
6. บันทึก commit SHA, migration, approver, deployer, เวลา และผล verification

Emergency change ต้องมีเหตุผล ผู้อนุมัติ และ retrospective ภายใน 2 วันทำการ

## 4. Backup and restore

ข้อเสนอเริ่มต้น: RPO 24 ชั่วโมง, RTO 8 ชั่วโมง — business owner ต้องยืนยัน

- เปิด Supabase PITR/backup ตาม RPO และทำ encrypted application export ตามรอบ
- เก็บ encryption passphrase และ `app_pii_key` แยกจาก backup ภายใต้ dual custody
- ทดสอบ restore ใน isolated project รายไตรมาส
- ตรวจ row counts, referential integrity, login, bill/payment totals, audit chain และ storage objects
- ทำลาย restored test data อย่างปลอดภัยเมื่อจบการทดสอบ
- หลักฐาน: วันที่, backup ID, ผู้ทดสอบ, actual RPO/RTO, checks, ปัญหา และ corrective action

## 5. Incident response

1. **Detect/record** — สร้าง incident ID, เวลา, reporter, system, CIA impact
2. **Triage** — Critical 1h, High 4h, Medium 1 business day, Low 3 business days
3. **Contain** — revoke session/key, disable account/function, preserve evidence; ห้ามทำลาย log
4. **Eradicate/recover** — patch, rotate, restore, validate RLS/audit chain และเฝ้าระวัง
5. **Privacy/legal** — DPO ประเมิน PDPA notification และผู้ได้รับผลกระทบตามกฎหมาย
6. **Learn** — post-incident review, root cause, control update และ risk register ภายใน 10 วันทำการ

ซ้อม tabletop อย่างน้อยปีละ 2 ครั้ง: (a) service-role key leak (b) ransomware/lost field device

## 6. Vulnerability and monitoring

- ทุก commit: repository security gate
- ทุก release: anonymous-access test, headers, RLS verification, audit-chain verification
- รายเดือน: dependency/CDN version review, privileged account review, failed-login/anomaly review
- รายไตรมาส: restore drill, vulnerability scan, access review, supplier status
- รายปีหรือหลัง major change: independent penetration test และ internal audit

## 7. Supplier and cloud review

สำหรับ Supabase, GitHub/hosting, LINE, ThaiBulkSMS, OpenRouter และ CDN ให้เก็บ:

- service owner, purpose, data categories, processing region/subprocessors
- DPA/contract, security assurance, breach SLA, deletion/export/exit method
- availability dependency, fallback, key owner และ last review date
- การเปลี่ยน supplier ต้องทำ DPIA/risk review และทดสอบ data deletion

## 8. Endpoint/offline operation

- อนุญาตเฉพาะอุปกรณ์ที่เข้ารหัสทั้งเครื่อง มี PIN/biometric, auto-lock และ patch ล่าสุด
- ห้ามใช้ shared browser profile กับบุคคลที่ไม่เกี่ยวข้อง
- cache สมาชิก/การเงินหมดอายุ 12 ชั่วโมง; logout/idle lock ล้าง cache
- offline queue/รูปต้อง sync เร็วที่สุด ตรวจ conflict แล้วลบจากอุปกรณ์
- อุปกรณ์หาย: แจ้งภายใน 1 ชั่วโมง, revoke account/session, remote wipe และเปิด incident

## 9. Business continuity

- เตรียมแบบฟอร์มจดมิเตอร์และรับชำระแบบ manual พร้อมเลขเอกสารควบคุม
- กำหนดขั้นตอน reconcile เมื่อระบบกลับมา ป้องกันบิล/ใบเสร็จซ้ำ
- ทดสอบ internet outage, Supabase outage และ power outage อย่างน้อยปีละครั้ง
- พิจารณา climate relevance ตาม Amendment 1:2024 เช่น น้ำท่วม ความร้อน ไฟฟ้าดับ และโครงข่ายเสียหาย พร้อมบันทึกข้อสรุปในการ management review

## 10. Internal audit and management review

Internal audit ต้องเป็นอิสระจากงานที่ตรวจ และตรวจ clauses 4–10, SoA, risk treatment, legal/PDPA, evidence sampling และ corrective actions อย่างน้อยปีละครั้ง

Management review ต้องบันทึกอย่างน้อย: audit/incident/KPI, interested-party changes, risks, supplier performance, resource needs, climate relevance, improvement decisions, owner และ due date

## Evidence index template

| Evidence ID | Control/risk | Period | Owner | Location | Reviewer | Result |
|---|---|---|---|---|---|---|
| EV-YYYY-001 | 8.13 / R-07 | YYYY-Qn | TBD | restricted evidence store | TBD | Pass/Fail |

ห้ามเก็บหลักฐานที่มี password, raw token, private key, เลขบัตรเต็ม หรือ production database dump ใน Git
