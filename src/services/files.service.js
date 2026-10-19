// ─── Files (Supabase Storage) ──────────────────────────────────
// buckets (ส่วนตัว, staff เท่านั้น — sql_phase1_documents.sql):
//   payment-slips  สลิปโอนเงิน   {ปี}/{เดือน}/{payment id}.jpg
//   meter-photos   รูปมิเตอร์     {ปี-เดือน}/{reading id}.jpg
// อัปโหลดได้อย่างเดียว แก้/ลบไม่ได้ (เป็นหลักฐาน)
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { toast } from '../utils/dom.util.js';
import { compressImage, splitStoragePath } from '../utils/image.util.js';

const MAX_BYTES = 5 * 1024 * 1024;

/** คืน path ที่บันทึก หรือ null ถ้าล้มเหลว (แสดง toast แล้ว) */
export async function uploadImage(bucket, path, file) {
  const blob = await compressImage(file);
  if (blob.size > MAX_BYTES) { toast('ไฟล์รูปใหญ่เกิน 5MB', 'error'); return null; }
  const { error } = await _sb.storage.from(bucket).upload(path, blob, {
    contentType: blob.type || 'image/jpeg', upsert: false, cacheControl: '31536000',
  });
  if (error) {
    console.error(`[storage] ${bucket}/${path}:`, error);
    toast(`อัปโหลดรูปไม่สำเร็จ: ${error.message}`, 'error');
    return null;
  }
  return path;
}

/**
 * URL ชั่วคราว (หมดอายุ 10 นาที) สำหรับดูรูป
 * path แบบ 'member-uploads:m12/x.jpg' (ผู้ใช้น้ำอัปโหลดผ่าน portal) จะใช้ bucket ตาม prefix
 */
export async function signedImageUrl(defaultBucket, value, expiresSec = 600) {
  if (!value) return null;
  const { bucket, path } = splitStoragePath(value, defaultBucket);
  const { data, error } = await _sb.storage.from(bucket).createSignedUrl(path, expiresSec);
  if (error) { toast(`เปิดรูปไม่ได้: ${error.message}`, 'error'); return null; }
  return data?.signedUrl || null;
}
