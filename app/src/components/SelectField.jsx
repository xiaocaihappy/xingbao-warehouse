import { useState, useRef, useEffect } from 'react';

/**
 * 可增删选项的下拉选择组件
 * @param {string} label - 字段标签
 * @param {string[]} defaultOptions - 默认选项（不可删除）
 * @param {string} storageKey - localStorage 存储 key
 * @param {string} value - 当前选中值
 * @param {function} onChange - 值变化回调
 * @param {string} placeholder - 占位文字
 * @param {boolean} required - 是否必填
 * @param {string} accent - 左边框颜色标识 (blue/cyan/purple/green)
 */
export default function SelectField({
  label,
  defaultOptions = [],
  storageKey,
  value,
  onChange,
  placeholder = '请选择',
  required = false,
  accent = 'blue',
}) {
  const [open, setOpen] = useState(false);
  const [customOptions, setCustomOptions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newOption, setNewOption] = useState('');
  const containerRef = useRef(null);
  const addInputRef = useRef(null);

  // 从 localStorage 加载已保存的自定义选项
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(`select_options_${storageKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCustomOptions(parsed);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  // 持久化自定义选项
  function saveOptions(opts) {
    setCustomOptions(opts);
    if (storageKey) {
      localStorage.setItem(`select_options_${storageKey}`, JSON.stringify(opts));
    }
  }

  // 合并所有选项
  const allOptions = [...defaultOptions, ...customOptions];

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setAdding(false);
        setNewOption('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // 自动聚焦新增输入框
  useEffect(() => {
    if (adding && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [adding]);

  function handleSelect(opt) {
    onChange(opt);
    setOpen(false);
  }

  function handleAddNew() {
    const trimmed = newOption.trim();
    if (!trimmed) {
      setAdding(false);
      setNewOption('');
      return;
    }
    if (allOptions.includes(trimmed)) {
      // 已存在，直接选中
      onChange(trimmed);
      setOpen(false);
      setAdding(false);
      setNewOption('');
      return;
    }
    saveOptions([...customOptions, trimmed]);
    onChange(trimmed);
    setOpen(false);
    setAdding(false);
    setNewOption('');
  }

  function handleDelete(opt) {
    saveOptions(customOptions.filter(o => o !== opt));
    if (value === opt) {
      onChange('');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNew();
    } else if (e.key === 'Escape') {
      setAdding(false);
      setNewOption('');
    }
  }

  const displayText = value || placeholder;

  return (
    <div
      className={`field-group field-accent-${accent}`}
      ref={containerRef}
    >
      <label className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
      </label>

      <div
        className={`select-field-trigger ${open ? 'select-field-open' : ''} ${value ? 'select-field-has-value' : ''}`}
        onClick={() => { setOpen(!open); setAdding(false); }}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      >
        <span className={`select-field-value ${!value ? 'select-field-placeholder' : ''}`}>
          {displayText}
        </span>
        <span className={`select-field-arrow ${open ? 'rotated' : ''}`}>▾</span>
      </div>

      {open && (
        <div className="select-field-dropdown">
          {allOptions.map((opt) => {
            const isCustom = customOptions.includes(opt);
            const isSelected = opt === value;
            return (
              <div
                key={opt}
                className={`select-field-option ${isSelected ? 'selected' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleSelect(opt); }}
              >
                <span className="select-field-option-text">{opt}</span>
                {isCustom && (
                  <button
                    className="select-field-delete-btn"
                    onClick={(e) => { e.stopPropagation(); handleDelete(opt); }}
                    title={`删除「${opt}」`}
                    type="button"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {/* 新增选项区域 */}
          {adding ? (
            <div className="select-field-add-row" onClick={e => e.stopPropagation()}>
              <input
                ref={addInputRef}
                className="select-field-add-input"
                type="text"
                value={newOption}
                onChange={e => setNewOption(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入新选项..."
                maxLength={30}
              />
              <button
                className="select-field-add-confirm"
                onClick={handleAddNew}
                type="button"
                disabled={!newOption.trim()}
              >
                ✓
              </button>
              <button
                className="select-field-add-cancel"
                onClick={() => { setAdding(false); setNewOption(''); }}
                type="button"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              className="select-field-add-trigger"
              onClick={(e) => { e.stopPropagation(); setAdding(true); }}
            >
              + 新增选项
            </div>
          )}
        </div>
      )}
    </div>
  );
}
