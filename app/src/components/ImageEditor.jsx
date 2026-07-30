import { useState, useRef, useEffect, useCallback } from 'react';
import { fileToImage, cropRotateToBlob } from '../utils/imageUtils';

const DISP_MAX = 340;
const MIN_SIDE = 24;

// 图片编辑弹窗：支持 1:1 正方形裁切 / 自由裁切 + 旋转（90°快转 + 滑块）
// 自由裁切：四角 + 四边均可独立拖动调整
// 返回裁剪+旋转后的压缩 Blob（通过 onApply）
export default function ImageEditor({ file, onApply, onCancel }) {
  const [img, setImg] = useState(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState('1:1'); // '1:1' | 'free'
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // 初始化图片与默认裁切框；单独维护 objectURL 用于显示，避免 fileToImage 立即 revoke 后裂图
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
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
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
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

  // 自由模式下，根据拖拽手柄计算新的 crop
  function computeFreeResize(handle, dx, dy, base, dw, dh) {
    const c = { ...base };
    switch (handle) {
      case 'se': {
        c.w = clamp(c.w + dx, MIN_SIDE, dw - c.x);
        c.h = clamp(c.h + dy, MIN_SIDE, dh - c.y);
        break;
      }
      case 'nw': {
        const nx = clamp(c.x + dx, 0, c.x + c.w - MIN_SIDE);
        const ny = clamp(c.y + dy, 0, c.y + c.h - MIN_SIDE);
        c.w = c.x + c.w - nx;
        c.h = c.y + c.h - ny;
        c.x = nx;
        c.y = ny;
        break;
      }
      case 'ne': {
        const ny = clamp(c.y + dy, 0, c.y + c.h - MIN_SIDE);
        c.w = clamp(c.w + dx, MIN_SIDE, dw - c.x);
        c.h = c.y + c.h - ny;
        c.y = ny;
        break;
      }
      case 'sw': {
        const nx = clamp(c.x + dx, 0, c.x + c.w - MIN_SIDE);
        c.w = c.x + c.w - nx;
        c.h = clamp(c.h + dy, MIN_SIDE, dh - c.y);
        c.x = nx;
        break;
      }
      case 'n': {
        const ny = clamp(c.y + dy, 0, c.y + c.h - MIN_SIDE);
        c.h = c.y + c.h - ny;
        c.y = ny;
        break;
      }
      case 's': {
        c.h = clamp(c.h + dy, MIN_SIDE, dh - c.y);
        break;
      }
      case 'w': {
        const nx = clamp(c.x + dx, 0, c.x + c.w - MIN_SIDE);
        c.w = c.x + c.w - nx;
        c.x = nx;
        break;
      }
      case 'e': {
        c.w = clamp(c.w + dx, MIN_SIDE, dw - c.x);
        break;
      }
      default:
        break;
    }
    return c;
  }

  // 1:1 模式下仅右下角缩放，保持正方形
  function computeSquareResize(dx, dy, base, dw, dh) {
    const c = { ...base };
    let nw = clamp(c.w + dx, MIN_SIDE, dw - c.x);
    if (mode === '1:1') {
      nw = Math.min(nw, dh - c.y, dw - c.x);
    }
    c.w = nw;
    c.h = nw;
    return c;
  }

  function onBoxMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'move', sx: e.clientX, sy: e.clientY, c: { ...crop } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startResize(handle) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { type: 'resize', handle, sx: e.clientX, sy: e.clientY, c: { ...crop } };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
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
    } else if (d.type === 'resize') {
      if (mode === '1:1') {
        setCrop(computeSquareResize(dx, dy, d.c, dw, dh));
      } else {
        setCrop(computeFreeResize(d.handle, dx, dy, d.c, dw, dh));
      }
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

  const handlePositions = [
    { key: 'nw', style: { left: -6, top: -6 }, cursor: 'nwse-resize' },
    { key: 'ne', style: { right: -6, top: -6 }, cursor: 'nesw-resize' },
    { key: 'sw', style: { left: -6, bottom: -6 }, cursor: 'nesw-resize' },
    { key: 'se', style: { right: -6, bottom: -6 }, cursor: 'nwse-resize' },
    { key: 'n', style: { left: '50%', top: -6, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { key: 's', style: { left: '50%', bottom: -6, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { key: 'w', style: { left: -6, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
    { key: 'e', style: { right: -6, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
  ];

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
              {img && objectUrl && <img src={objectUrl} alt="" className="img-editor-img" draggable={false} />}
              <div
                className="img-editor-crop"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                onMouseDown={onBoxMouseDown}
              >
                <div className="img-editor-crop-grid" />
                {/* 1:1 模式只保留右下角缩放；自由模式启用四角 + 四边 */}
                {mode === 'free'
                  ? handlePositions.map((h) => (
                      <div
                        key={h.key}
                        className={`img-editor-handle img-editor-handle--${h.key}`}
                        style={{ ...h.style, cursor: h.cursor }}
                        onMouseDown={startResize(h.key)}
                      />
                    ))
                  : (
                      <div
                        className="img-editor-handle img-editor-handle--se"
                        style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }}
                        onMouseDown={startResize('se')}
                      />
                    )}
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
