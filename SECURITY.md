# Security Policy

## เวอร์ชันที่รองรับ

รองรับเฉพาะ revision ล่าสุดบน branch ที่ใช้ deploy production เจ้าของระบบต้องบันทึก commit SHA และวันที่ deploy ทุกครั้ง

## รายงานช่องโหว่

ห้ามเปิดเผยช่องโหว่ ข้อมูลส่วนบุคคล token key หรือภาพหน้าจอ production ผ่าน public issue ให้รายงานผ่านช่องทางส่วนตัวถึงเจ้าของระบบหรือผู้ประสานงานความมั่นคงปลอดภัยที่หน่วยงานแต่งตั้ง

ข้อมูลขั้นต่ำที่ควรส่ง:

- วันที่และเวลาที่พบ พร้อม timezone
- URL/หน้าจอ/ฟังก์ชันที่ได้รับผลกระทบ
- ขั้นตอนทำซ้ำโดยไม่ใส่ข้อมูลส่วนบุคคลจริง
- ผลกระทบต่อ confidentiality, integrity หรือ availability
- log correlation ID หรือ audit event ID ถ้ามี

ห้ามแนบรหัสผ่าน, session token, service-role key, เลขบัตรประชาชนเต็ม หรือไฟล์สำรองข้อมูล

## SLA การตอบสนองภายใน

| ระดับ | ตัวอย่าง | รับทราบ | เริ่มควบคุม |
|---|---|---:|---:|
| Critical | ข้อมูลจำนวนมากรั่ว, service-role key หลุด, แก้ยอดเงินได้ | 1 ชั่วโมง | ทันที |
| High | ข้ามสิทธิ์, ยึดบัญชี admin, PII รั่วรายบุคคล | 4 ชั่วโมง | 24 ชั่วโมง |
| Medium | ช่องโหว่ต้องมีเงื่อนไขหลายขั้น, log ไม่ครบ | 1 วันทำการ | 5 วันทำการ |
| Low | hardening หรือข้อมูลที่ไม่อ่อนไหว | 3 วันทำการ | ตามรอบ release |

เหตุข้อมูลส่วนบุคคลต้องเข้าสู่ขั้นตอน incident/PDPA ใน `docs/iso27001/OPERATING_PROCEDURES.md` และ `docs/SECURITY_PDPA.md` ทันที

## Secret handling

- เก็บ Supabase service-role, JWT signing key, PII encryption key, LINE, SMS และ OpenRouter secrets ใน Supabase Vault/Edge Function secrets เท่านั้น
- `config.js` อนุญาตเฉพาะ public URL และ anon key
- หาก secret หลุด ให้ revoke/rotate ก่อนลบออกจาก Git และประเมินประวัติการเข้าถึงย้อนหลัง
