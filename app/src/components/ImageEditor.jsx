import { useState, useRef, useEffect, useCallback } from 'react';
import { fileToImage, cropRotateToBlob } from '../utils/imageUtils';

const DISP_MAX = 340;
const MIN_SIDE = 24;

// 图片编辑弹窗：支持 1:1 正方形裁切 / 自由裁切 + 旋转（90°快转 + 滑块）
// 返回裁剪+旋转后的压缩 Blob（通过 onApply）
export default function ImageEditor({ file, onApply, onCancel }) {
  const [img, setImg] = useState(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState('1:1'); // '1:1' | 'free'
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  // 初始化图片与默认裁切框
  useEffect(() => {
    let alive = true;
    fileToImage(file).then((image) => {
      if (!alive) return;
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      const dw = Math.min(DISP_MAX, w);
      const dh = Math.round((dw * h) / w);
      setImg(image);
      setNat({ w, h });
      setDisp({ w: dw, h: dh });
      setCrop(initCrop(mode, dw, dh));
    }).catch(() => {});
    return () => { alive = false; };
    // 仅依赖 file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // 切换裁切模式时重置裁切框
  function handleModeChange(m) {
    setMode(m);
    const { w, h } = disp;
    if (w && h) setCrop(initCrop(m, w, h));
  }

  function initCrop(m, dw, dh) {
    if (m === '1:1') {
      const side = Math.min(dw, dh) * 0.85;
      return { x: (dw - side) / 2, y: (dh - side) / 2, w: side, h: side };
    }
    return { x: 0, y: 0, w: dw, h: dh };
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function onBoxMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'move', sx: e.clientX, sy: e.clientY, c: { ...crop } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onHandleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'resize', sx: e.clientX, sy: e.clientY, c: { ...crop } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  const onMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const { w: dw, h: dh } = disp;
    if (d.type === 'move') {
      const nx = clamp(d.c.x + dx, 0, dw - d.c.w);
      const ny = clamp(d.c.y + dy, 0, dh - d.c.h);
      setCrop({ ...d.c, x: nx, y: ny });
    } else {
      let nw = clamp(d.c.w + dx, MIN_SIDE, dw - d.c.x);
      let nh = d.c.h;
      if (mode === '1:1') {
        nw = Math.min(nw, dh - d.c.y, dw - d.c.x);
        nh = nw;
      } else {
        nh = clamp(d.c.h + dy, MIN_SIDE, dh - d.c.y);
      }
      setCrop({ ...d.c, w: nw, h: nh });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp, mode]);

  function onUp() {
    dragRef.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove]);

  async function handleApply() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const scale = nat.w / disp.w;
      const naturalCrop = {
        x: crop.x * scale,
        y: crop.y * scale,
        w: crop.w * scale,
        h: crop.h * scale,
      };
      const blob = await cropRotateToBlob(img, naturalCrop, rotation, { quality: 0.9 });
      onApply?.(blob);
    } catch {
      setBusy(false);
    }
  }

  const rotate = (delta) => setRotation((r) => (r + delta + 360) % 360);

  return (
    <div className="img-editor-overlay" onClick={onCancel}>
      <div className="img-editor-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="img-editor-title">图片编辑</h3>
        <p className="img-editor-sub">拖拽选框调整范围，切换 1:1 或自由裁切，并支持旋转</p>

        <div className="img-editor-toolbar">
          <div className="img-editor-mode">
            <button
              className={`img-editor-mode-btn ${mode === '1:1' ? 'active' : ''}`}
              onClick={() => handleModeChange('1:1')}
            >1:1 正方形</button>
            <button
              className={`img-editor-mode-btn ${mode === 'free' ? 'active' : ''}`}
              onClick={() => handleModeChange('free')}
            >自由裁切</button>
          </div>
          <div className="img-editor-rotate">
            <button className="img-editor-rot-btn" onClick={() => rotate(-90)} title="向左旋转 90°">⟲</button>
            <input
              type="range"
              min="0"
              max="359"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="img-editor-rot-slider"
            />
            <button className="img-editor-rot-btn" onClick={() => rotate(90)} title="向右旋转 90°">⟳</button>
            <span className="img-editor-rot-val">{rotation}°</span>
          </div>
        </div>

        <div className="img-editor-stage-wrap">
          {disp.w > 0 && (
            <div
              ref={stageRef}
              className="img-editor-stage"
              style={{
                width: disp.w,
                height: disp.h,
                transform: `rotate(${rotation}deg)`,
              }}
            >
              {img && <img src={img.src} alt="" className="img-editor-img" draggable={false} />}
              <div
                className="img-editor-crop"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                onMouseDown={onBoxMouseDown}
              >
                <div className="img-editor-crop-grid" />
                <div className="img-editor-handle" onMouseDown={onHandleMouseDown} />
              </div>
            </div>
          )}
        </div>

        <div className="img-editor-actions">
          <button className="img-editor-btn img-editor-btn--cancel" onClick={onCancel} disabled={busy}>取消</button>
          <button className="img-editor-btn img-editor-btn--apply" onClick={handleApply} disabled={busy}>
            {busy ? '处理中...' : '应用'}
          </button>
        </div>
      </div>
    </div>
  );
}
