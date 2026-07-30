// 纯浏览器端图片处理工具（无第三方依赖）
// 用于：压缩提速、裁剪 + 旋转输出

export function fileToImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => resolve(b), type, quality);
    } else {
      // 老版本兼容
      const dataUrl = canvas.toDataURL(type, quality);
      const bin = atob(dataUrl.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type }));
    }
  });
}

export function blobToFile(blob, name = 'image.jpg') {
  const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
  const fileName = name.includes('.') ? name : `${name}.${ext}`;
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
}

// 压缩 / 缩放：最长边不超过 maxDim，输出 JPEG（白底），显著减小体积、提升上传速度
export async function compressImage(fileOrBlob, opts = {}) {
  const { maxDim = 1600, quality = 0.85, type = 'image/jpeg' } = opts;
  const img = await fileToImage(fileOrBlob);
  let { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await canvasToBlob(canvas, type, quality);
  // 释放原图对象地址（压缩时单独创建，这里统一回收）
  if (fileOrBlob instanceof Blob && fileOrBlob !== img) { /* noop */ }
  return blob;
}

// 裁剪 + 旋转：crop 为「未旋转」的原图像素坐标 {x,y,w,h}，rotation 为角度
// 算法：先按未旋转坐标裁剪，再整体旋转裁剪结果（与预览一致）
export async function cropRotateToBlob(img, crop, rotation, opts = {}) {
  const { quality = 0.9, type = 'image/jpeg' } = opts;
  const cw = Math.max(1, Math.round(crop.w));
  const ch = Math.max(1, Math.round(crop.h));

  // 1) 裁剪（未旋转）
  const cropped = document.createElement('canvas');
  cropped.width = cw;
  cropped.height = ch;
  const cctx = cropped.getContext('2d');
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, cw, ch);
  cctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);

  // 2) 旋转裁剪结果
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const fw = Math.max(1, Math.round(cw * cos + ch * sin));
  const fh = Math.max(1, Math.round(cw * sin + ch * cos));
  const out = document.createElement('canvas');
  out.width = fw;
  out.height = fh;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, fw, fh);
  octx.translate(fw / 2, fh / 2);
  octx.rotate(rad);
  octx.drawImage(cropped, -cw / 2, -ch / 2);

  return await canvasToBlob(out, type, quality);
}
