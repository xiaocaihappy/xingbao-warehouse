import { useState, useRef } from 'react';
import { uploadImage } from '../supabase';
import { blobToFile } from './imageUtils';

// 后台上传器：选/拖图片 → 压缩/裁剪后异步上传，组件保存时等待在途上传完成，避免存到半截图片
export function useImageUploader(showToast) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState(null);
  const tokenRef = useRef(0);
  const pendingRef = useRef(null);
  const urlRef = useRef(null);

  function startUpload(blob) {
    const token = ++tokenRef.current;
    const file = blobToFile(blob, `sample_${Date.now()}.jpg`);
    setUploading(true);
    setLocalPreview(URL.createObjectURL(blob));
    const p = uploadImage(file)
      .then(({ data, error }) => {
        // 已被新的上传取代，丢弃本次结果
        if (token !== tokenRef.current) return urlRef.current;
        if (error) {
          showToast?.('图片上传失败: ' + (error.message || '未知错误'), 'error');
          setUploading(false);
          setLocalPreview(null);
          return null;
        }
        urlRef.current = data;
        setUploading(false);
        return data;
      })
      .catch((err) => {
        if (token === tokenRef.current) {
          showToast?.('图片上传异常: ' + (err?.message || '未知错误'), 'error');
          setUploading(false);
          setLocalPreview(null);
        }
        return null;
      });
    pendingRef.current = p;
    return p;
  }

  // 等待在途上传完成，返回最终可用的图片地址
  async function awaitPending() {
    if (!uploading || !pendingRef.current) return urlRef.current;
    const u = await pendingRef.current;
    return u || urlRef.current;
  }

  function clear() {
    tokenRef.current++; // 作废在途上传
    urlRef.current = null;
    pendingRef.current = null;
    setLocalPreview(null);
    setUploading(false);
  }

  return { uploading, localPreview, startUpload, awaitPending, clear };
}
