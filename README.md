# AquaFlow Pro

ระบบบริหารประปาหมู่บ้านแบบ Progressive Web App สำหรับสมาชิก มิเตอร์ บิล การรับชำระ รายงาน งานภาคสนาม และพอร์ทัลผู้ใช้น้ำ โดยใช้ Supabase เป็นฐานข้อมูลและ API

## โครงสร้างหลัก

- `index.html` — แอปเจ้าหน้าที่
- `portal.html` — พอร์ทัลผู้ใช้น้ำ
- `src/` — โค้ดปัจจุบันแบบ ES modules
- `styles/` — stylesheet ปัจจุบัน
- `supabase/functions/` — Edge Functions สำหรับ OCR และ LINE
- `sql/` — schema, migration, RLS, audit, retention และสคริปต์ตรวจการติดตั้ง
- `docs/` — คู่มือติดตั้ง ความปลอดภัย PDPA และหลักฐานเตรียม ISO/IEC 27001
- `js/`, `css/` — โค้ดรุ่นเก่าที่ต้องเก็บไว้จนกว่าจะยืนยันว่า deployment ไม่อ้างถึง

## เริ่มใช้งานสำหรับพัฒนา

1. คัดลอก `config.example.js` เป็น `config.js` และตั้งค่า Supabase URL กับ anon key
2. ใช้ static HTTP server จากโฟลเดอร์ราก ห้ามเปิดด้วย `file://`
3. เปิด `http://localhost:<port>/`

`config.js` มีเฉพาะ Supabase anon key ซึ่งเป็นค่าฝั่ง browser; สิทธิ์จริงต้องบังคับด้วย RLS/RPC ห้ามใส่ service-role key หรือ secret ของผู้ให้บริการใด ๆ ในไฟล์นี้

## ตรวจสอบก่อน merge/deploy

```text
npm run check
```

คำสั่งนี้ตรวจไฟล์หลัก, CSP/SRI, relative imports, high-confidence secret patterns, database security markers, อายุ offline cache, inactivity lock และชุดหลักฐาน ISO readiness โดยไม่เชื่อมต่อหรือแก้ฐานข้อมูล

ก่อนเปิด production ให้รัน `sql/verify_install.sql` ใน Supabase SQL Editor และเก็บผลเป็นหลักฐานตาม `docs/iso27001/OPERATING_PROCEDURES.md`

## ความปลอดภัยและมาตรฐาน

- แนวทางระบบและ PDPA: `docs/SECURITY_PDPA.md`
- ผลประเมิน ISO/IEC 27001:2022: `docs/iso27001/READINESS_AUDIT.md`
- ความเสี่ยงและแผนจัดการ: `docs/iso27001/RISK_REGISTER.md`
- Statement of Applicability: `docs/iso27001/STATEMENT_OF_APPLICABILITY.md`
- ขั้นตอนปฏิบัติและหลักฐาน: `docs/iso27001/OPERATING_PROCEDURES.md`
- การรายงานช่องโหว่: `SECURITY.md`

เอกสารใน repository เป็นหลักฐานทางเทคนิคและต้นแบบกระบวนการ ไม่ใช่ใบรับรอง ISO/IEC 27001 การรับรองต้องตรวจทั้งองค์กรโดยหน่วยรับรองที่ได้รับการรับรอง
