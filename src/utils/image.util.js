// ─── Image helpers ─────────────────────────────────────────────
// ไม่ import อะไร — ใช้ได้ทั้งแอปเจ้าหน้าที่และ portal ผู้ใช้น้ำ
// ──────────────────────────────────────────────────────────────

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

/** 'bucket:path' (ไฟล์ที่ผู้ใช้น้ำอัปโหลด) หรือ 'path' (bucket ค่าเริ่มต้น) → { bucket, path } */
export function splitStoragePath(value, defaultBucket) {
  const m = /^([a-z0-9-]+):(.+)$/.exec(value || '');
  return m ? { bucket: m[1], path: m[2] } : { bucket: defaultBucket, path: value };
}
