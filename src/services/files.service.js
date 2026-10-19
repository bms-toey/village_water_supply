// ─── Files (Supabase Storage) ──────────────────────────────────
// buckets (ส่วนตัว, staff เท่านั้น — sql_phase1_documents.sql):
//   payment-slips  สลิปโอนเงิน   {ปี}/{เดือน}/{payment id}.jpg
//   meter-photos   รูปมิเตอร์     {ปี-เดือน}/{reading id}.jpg
// อัปโหลดได้อย่างเดียว แก้/ลบไม่ได้ (เป็นหลักฐาน)
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { toast } from '../utils/dom.util.js';

const MAX_BYTES = 5 * 1024 * 1024;

/** ย่อรูปเป็น JPEG ด้านยาวไม่เกิน maxDim — ประหยัดเน็ตมือถือในพื้นที่สัญญาณอ่อน */
export async function compressImage(file, maxDim = 1600, quality = 0.8) {
  try {
    const bmp   = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;   // เบราว์เซอร์เก่า — ส่งไฟล์เดิม
  }
}

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

/** URL ชั่วคราว (หมดอายุ 10 นาที) สำหรับดูรูป */
export async function signedImageUrl(bucket, path, expiresSec = 600) {
  if (!path) return null;
  const { data, error } = await _sb.storage.from(bucket).createSignedUrl(path, expiresSec);
  if (error) { toast(`เปิดรูปไม่ได้: ${error.message}`, 'error'); return null; }
  return data?.signedUrl || null;
}
