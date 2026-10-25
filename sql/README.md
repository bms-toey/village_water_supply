# ลำดับการรัน SQL (Supabase → SQL Editor)

ฐานข้อมูลที่ใช้งานอยู่แล้ว รันเฉพาะไฟล์ที่ยังไม่เคยรัน **ตามลำดับนี้** ทุกไฟล์รันซ้ำได้
และรันอยู่ใน transaction เดียว (ถ้าผิดพลาดกลางทาง จะไม่มีอะไรเปลี่ยน)

| ลำดับ | ไฟล์ | สิ่งที่ได้ | หมายเหตุ |
|---|---|---|---|
| 1 | `sql_secure_auth.sql` | Login + JWT + RLS | ต้องใส่ JWT secret ใน Vault ก่อน (ดูหัวไฟล์) |
| 2 | `sql_phase0_finance.sql` | เลขเอกสารจาก server, ปิดงวด, ใบลดหนี้/เพิ่มหนี้, ค่าปรับอัตโนมัติ, audit, backup | เปิด extension `pg_cron` ก่อนจะดีที่สุด |
| 3 | `sql_phase1_documents.sql` | ผู้รับเงินจาก JWT, ต้นฉบับ/สำเนาใบเสร็จ, ปิดยอดประจำวัน, Storage สลิป+รูปมิเตอร์ | สร้าง bucket ให้อัตโนมัติ |
| 4 | `sql_phase2_notify.sql` | แจ้งเตือนเจ้าหน้าที่, Portal ผู้ใช้น้ำ, คิว LINE/SMS, เพิ่มตารางเข้า Realtime | LINE OA ทำทีหลังได้ — ดู `docs/LINE_SETUP.md` |
| 5 | `sql_phase3_accounting.sql` | สมุดเงินสด (รายรับอื่น/รายจ่าย), บันทึกการผลิตน้ำ, รายงานกรรมการ | ตั้งยอดยกมาใน ตั้งค่าทั่วไป → บัญชีกองทุน |
| 6 | `sql_phase4_field.sql` | มิเตอร์วนรอบ, บันทึกเหตุผลที่จดไม่ได้ (+เปิดงานซ่อมมิเตอร์เสีย), ลำดับเส้นทาง | ตั้ง `meter_max_reading` ได้ (ค่าเริ่มต้น 9999) |
| 7 | `sql_phase5_security.sql` | สิทธิ์ตามหน้าที่ (บังคับที่ server), จดมิเตอร์ผ่าน RPC เดียว (คิดค่าน้ำที่ server), เชื่อมข้อมูลด้วย ID (ผู้ทำรายการเป็น uuid, FK คู่, กันจด/ชำระซ้ำ), เลขบัตรประชาชนเข้ารหัส, audit แก้ไม่ได้ + hash chain, ออกจากระบบ = เพิกถอน token, คำขอ PDPA / ทำข้อมูลนิรนาม / ลบข้อมูลเกินระยะเวลาเก็บ, ปิดช่องโหว่ (API key, LINE, สมัครสมาชิกเอง, sign_jwt) | **ต้องรันหลังเฟส 4 และรันซ้ำทุกครั้งที่รันไฟล์เก่าซ้ำ** — ดูขั้นตอนหลังรันด้านล่าง |

หลังรัน SQL แล้วให้ deploy frontend เวอร์ชันเดียวกันทันที

### หลังรัน `sql_phase5_security.sql` (ทำครั้งเดียว)

1. **Authentication → Sign In / Providers** → ปิด *Allow new users to sign up* (ระบบไม่ใช้ Supabase Auth)
2. **Project Settings → API → Exposed schemas** ต้องมีแค่ `public` (และ `graphql_public`) — **ห้ามเพิ่ม `app_private`**
   (ใน schema นั้นมีฟังก์ชันออก token ถ้าเปิดออก API ใครก็ปลอม token ได้)
3. **Database → Extensions** เปิด `pg_cron` แล้วรันส่วนท้าย (หัวข้อ 12) ของไฟล์อีกครั้ง → งานลบข้อมูลเกินระยะเวลาเก็บรายวัน
4. **AI อ่านมิเตอร์** ย้ายไปเรียกผ่าน Edge Function `meter-ocr` แล้ว (ไฟล์นี้ลบ `openrouter_api_key` ออกจาก system_config):
   - **ยกเลิก key เดิมที่ openrouter.ai แล้วออก key ใหม่** (key เดิมเคยถูกส่งไปทุกเครื่องของเจ้าหน้าที่และอยู่ใน audit log)
   - `npx supabase secrets set OPENROUTER_API_KEY=sk-or-... ALLOWED_ORIGINS=https://<โดเมนแอป>`
   - `npx supabase functions deploy meter-ocr --no-verify-jwt` (function ตรวจสิทธิ์เจ้าหน้าที่เองด้วย `staff_whoami`)
   - deploy `line-webhook` ใหม่ด้วย (ไม่ส่งรหัส portal ทาง LINE แล้ว)
5. **Vault: `app_pii_key`** ถูกสร้างอัตโนมัติ ใช้เข้ารหัสเลขบัตรประชาชน — **ห้ามลบ/เปลี่ยน** ถ้าหาย เลขบัตรที่เข้ารหัสไว้จะอ่านไม่ได้อีก
   (ไฟล์สำรองข้อมูลไม่มี key นี้ — เก็บสำเนา key ไว้ที่ปลอดภัยแยกต่างหาก)
6. รัน `verify_install.sql` — ทุกแถวควรเป็น ✅
7. ทุกคน login ใหม่หนึ่งครั้ง (token รุ่นใหม่มี jti สำหรับออกจากระบบ)

รายละเอียดสิทธิ์แต่ละตำแหน่ง, บันทึกกิจกรรมการประมวลผล (ROPA), ระยะเวลาเก็บข้อมูล และขั้นตอนเมื่อข้อมูลรั่ว: `docs/SECURITY_PDPA.md`

> **ถ้าต้องรันไฟล์เก่าซ้ำ** ให้รันไฟล์ที่ลำดับสูงกว่าซ้ำด้วยทุกไฟล์ —
> ไฟล์หลังแก้ไขฟังก์ชันของไฟล์ก่อนหน้า (เช่น `run_daily_billing`) การรันไฟล์เก่าทีหลังจะย้อนฟังก์ชันกลับเป็นรุ่นเก่า

## ไฟล์ที่เลิกใช้ (ห้ามรัน)

- `sql_simple_auth.sql`, `sql_fix_anon_grant.sql` — เปิดสิทธิ์ให้ผู้ที่ไม่ได้ login (มีตัวกันรันอยู่แล้ว)
- `sql_login_fix.sql`, `sql_admin_users.sql`, `sql_user_management.sql`, `sql_rls_policies.sql`, `sql_fix_existing_users.sql`
  — ฟังก์ชัน/สิทธิ์รุ่นเก่าที่สมาชิกใน portal ใช้เปลี่ยน role เจ้าหน้าที่ได้ ถ้ารันซ้ำ (มีตัวกันรันแล้ว)
  ตัวกันรันทำงานใน SQL Editor (รันทั้งไฟล์เป็น transaction เดียว) — ถ้าใช้ `psql` ต้องใส่ `-v ON_ERROR_STOP=1`
- ไฟล์ `sql_batch*`, `supabase_schema.sql` — ใช้สร้างฐานข้อมูลใหม่ครั้งแรกเท่านั้น
  (`sql_batch1_tables.sql` จะ **ลบตารางทั้งหมด** ถ้ารันกับฐานข้อมูลเดิม)
