# เปิดใช้การแจ้งเตือนทาง LINE OA

ระบบเตรียมไว้ครบแล้ว ข้อความทุกประเภทจะเข้าคิว (`notification_outbox`) อัตโนมัติ
เมื่อทำตามขั้นตอนนี้ คิวจะถูกส่งออกทาง LINE ภายใน 1 นาที

| ข้อความ | ส่งเมื่อ |
|---|---|
| ใบแจ้งค่าน้ำ | ออกบิลใหม่ |
| ใกล้ครบกำหนด | 3 วันก่อนครบกำหนด (00:05 น.) |
| เลยกำหนด | บิลเลยกำหนดชำระ |
| รับชำระแล้ว | อนุมัติการชำระ/รับเงินสด |
| เตือนค้างชำระ | เจ้าหน้าที่กดส่งจากหน้าลูกหนี้ |
| ประกาศ | ผู้ดูแลส่งจาก ตั้งค่า → แจ้งเตือน & LINE |

## 1. สร้าง LINE Official Account

1. ไปที่ https://manager.line.biz → สร้างบัญชี (แพ็กเกจฟรีส่งได้ 300 ข้อความ/เดือน)
2. ตั้งค่า → Messaging API → **เปิดใช้งาน** (สร้าง Provider ใหม่ได้)
3. เข้า https://developers.line.biz → เลือก channel ที่สร้าง
   - แท็บ Basic settings → คัดลอก **Channel secret**
   - แท็บ Messaging API → **Channel access token (long-lived)** → Issue → คัดลอก
4. ใน LINE OA Manager → ตั้งค่าการตอบกลับ → ปิด "ข้อความตอบกลับอัตโนมัติ" และเปิด "Webhook"

## 2. Deploy Edge Functions

ต้องติดตั้ง Node.js แล้วรันในโฟลเดอร์โปรเจกต์:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>

# สุ่มรหัสลับสำหรับ dispatch (เก็บไว้ใช้ในขั้นที่ 3)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

npx supabase secrets set \
  LINE_CHANNEL_SECRET=<channel secret> \
  LINE_CHANNEL_ACCESS_TOKEN=<channel access token> \
  DISPATCH_SECRET=<รหัสที่สุ่มได้> \
  PORTAL_URL=https://<เว็บของคุณ>/portal.html

npx supabase functions deploy line-webhook  --no-verify-jwt
npx supabase functions deploy line-dispatch --no-verify-jwt
```

## 3. ตั้งเวลาส่งคิวทุกนาที (SQL Editor)

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'aquaflow_functions_url');
SELECT vault.create_secret('<รหัสที่สุ่มได้ — ตัวเดียวกับ DISPATCH_SECRET>', 'aquaflow_dispatch_secret');
CREATE EXTENSION IF NOT EXISTS pg_net;
```

จากนั้นรันคำสั่ง `cron.schedule('aquaflow-line-dispatch', ...)` ที่ท้ายไฟล์ `sql/sql_phase2_notify.sql` (ส่วนที่ 6)

## 4. ตั้ง Webhook ใน LINE

LINE Developers → Messaging API → Webhook URL:

```
https://<project-ref>.supabase.co/functions/v1/line-webhook
```

กด **Verify** แล้วเปิด **Use webhook**

## 5. ในแอป

ตั้งค่า → แจ้งเตือน & LINE → ใส่ **LINE OA ID** (เช่น `@abc1234`) → บันทึก
ใบแจ้งค่าน้ำที่พิมพ์หลังจากนี้จะมีวิธีผูก LINE พร้อมรหัสของแต่ละบ้าน

## สมาชิกผูกบัญชีอย่างไร

1. เพิ่มเพื่อน LINE OA
2. พิมพ์ `ผูก <เลขมิเตอร์> <รหัส 6 หลัก>` เช่น `ผูก WM-0012 AB12CD` (รหัสอยู่บนใบแจ้งค่าน้ำ)
3. พิมพ์ `บิล` เพื่อดูยอดค้าง, `ยกเลิกการผูก` เพื่อหยุดรับข้อความ

## SMS (ไม่บังคับ)

สำหรับบ้านที่ไม่มี LINE — ใช้ ThaiBulkSMS (มีค่าใช้จ่ายต่อข้อความ)

```bash
npx supabase secrets set SMS_PROVIDER=thaibulksms THAIBULKSMS_API_KEY=... THAIBULKSMS_API_SECRET=... SMS_SENDER=...
```

แล้วเปิด "ส่ง SMS ให้คนที่ไม่มี LINE" ในหน้าตั้งค่า

## ตรวจสอบ

ตั้งค่า → แจ้งเตือน & LINE แสดงจำนวนที่ผูกแล้ว, คิวรอส่ง, ส่งแล้ว, ส่งไม่สำเร็จ (ชี้เมาส์ที่ไอคอนเพื่อดูสาเหตุ)
ข้อความที่ส่งไม่สำเร็จจะลองใหม่อัตโนมัติสูงสุด 5 ครั้ง
