import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * 可增删选项的下拉选择组件（使用 Portal 渲染下拉，逃出所有堆叠上下文）
 * @param {string} label - 字段标签
 * @param {string[]} defaultOptions - 默认选项（不可删除）
 * @param {string[]} options - 受控的完整选项列表
 * @param {function} onOptionsChange - 选项变化回调
 * @param {string} value - 当前选中值
 * @param {function} onChange - 值变化回调
 * @param {string} placeholder - 占位文字
 * @param {boolean} required - 是否必填
 * @param {string} accent - 左边框颜色标识
 */
export default function SelectField({
  label,
  defaultOptions = [],
  options: controlledOptions,
  onOptionsChange,
  value,
  onChange,
  placeholder = '请选择',
  required = false,
  accent = 'blue',
  externalTriggerRef,
  onAfterSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [internalOptions, setInternalOptions] = useState(defaultOptions);
  const [adding, setAdding] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const addInputRef = useRef(null);

  // 支持受控或非受控模式
  const allOptions = controlledOptions || internalOptions;

  function setOptions(next) {
    if (onOptionsChange) onOptionsChange(next);
    if (!controlledOptions) setInternalOptions(next);
  }

  // 计算下拉菜单位置（基于 trigger 的位置）
  function updatePosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }

  // 打开时计算位置
  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open]);

  // 监听滚动和窗口大小变化，更新位置
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inTrigger && !inDropdown) {
        setOpen(false);
        setAdding(false);
        setNewOption('');
      }
    }
    // 使用 mousedown 比 click 更快响应
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
    onAfterSelect?.();
  }

  function handleAddNew() {
    const trimmed = newOption.trim();
    if (!trimmed) {
      setAdding(false);
      setNewOption('');
      return;
    }
    if (allOptions.includes(trimmed)) {
      onChange(trimmed);
      setOpen(false);
      setAdding(false);
      setNewOption('');
      return;
    }
    setOptions([...allOptions, trimmed]);
    onChange(trimmed);
    setOpen(false);
    setAdding(false);
    setNewOption('');
  }

  function handleDelete(opt) {
    setOptions(allOptions.filter(o => o !== opt));
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
    >
      <label className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
      </label>

      <div
        ref={(el) => { triggerRef.current = el; if (externalTriggerRef) externalTriggerRef.current = el; }}
        className={`select-field-trigger ${open ? 'select-field-open' : ''} ${value ? 'select-field-has-value' : ''} ${disabled ? 'select-field-disabled' : ''}`}
        onClick={() => { if (disabled) return; setOpen(!open); setAdding(false); }}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (disabled) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      >
        <span className={`select-field-value ${!value ? 'select-field-placeholder' : ''}`}>
          {displayText}
        </span>
        <span className={`select-field-arrow ${open ? 'rotated' : ''}`}>▾</span>
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="select-field-dropdown select-field-dropdown--portal"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="select-field-options">
            {allOptions.map((opt) => {
              const isCustom = !defaultOptions.includes(opt);
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
          </div>

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
        </div>,
        document.body
      )}
    </div>
  );
}
