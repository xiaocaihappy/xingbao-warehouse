import { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { insertItem, uploadImage, fetchStaffList, addStaffMember, deleteStaffMember, seedDefaultStaff, subscribeToStaffList, fetchItems } from '../supabase';
import SelectField from '../components/SelectField';
import * as XLSX from 'xlsx';

const INITIAL_FORM = {
  shelf_number: '',
  grid_number: '',
  product_code: '',
  stamp_code: '',
  sales_channel: '',
  staff_name: '',
  image_url: '',
};

// 默认销售选项
const DEFAULT_SALES = ['内销-L', '外贸-菜', '外销-V', '外销-BL', '电商-JH'];

// 默认人员选项
const DEFAULT_STAFF_BASE = ['陈育婷', '蔡丹媛', '蔡中卫', '林沐锟', '丁小梅', '林晓媛'];

// localStorage key
const LS_KEY = {
  sales: 'select_options_sales_channel',
  staff: 'select_options_staff_name',
};

// 输入历史管理（每个字段保留最近5条）
const HISTORY_KEY_PREFIX = 'xingbao_input_history_';
const MAX_HISTORY = 5;
function getFieldHistory(fieldKey) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + fieldKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    }
  } catch {}
  return [];
}
function addFieldHistory(fieldKey, value) {
  if (!value || !value.trim()) return;
  const history = getFieldHistory(fieldKey);
  const filtered = history.filter(h => h !== value.trim());
  filtered.unshift(value.trim());
  const trimmed = filtered.slice(0, MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY_PREFIX + fieldKey, JSON.stringify(trimmed)); } catch {}
}
function clearFieldHistory(fieldKey) {
  try { localStorage.removeItem(HISTORY_KEY_PREFIX + fieldKey); } catch {}
}

// 带历史记录的下拉输入框组件（Portal 渲染，解决层级穿透问题）
function HistoryInput({ value, onChange, placeholder, fieldKey, inputRef, onEnter }) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const history = getFieldHistory(fieldKey);

  function updatePosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open]);

  useEffect(() => {
    function handleClick(e) {
      if (triggerRef.current && !triggerRef.current.contains(e.target)) {
        const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
        if (!inDropdown) setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="stg-field-input-wrap" ref={triggerRef} style={{ position: "relative" }}>
      <input
        type="text"
        className="stg-field-input"
        value={value}
        ref={inputRef}
        onChange={e => onChange(e.target.value)}
        onFocus={() => history.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setOpen(false);
            onEnter?.();
          }
        }}
        placeholder={placeholder}
      />
      {history.length > 0 && (
        <button
          type="button"
          className="stg-history-toggle"
          onClick={() => setOpen(!open)}
          tabIndex={-1}
          title="历史记录"
        >&#x25BC;</button>
      )}
      {open && history.length > 0 && createPortal(
        <div
          ref={dropdownRef}
          className="stg-history-dropdown stg-history-dropdown--portal"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {history.map((h, hi) => (
            <div
              key={hi}
              className="stg-history-item"
              onMouseDown={() => { onChange(h); setOpen(false); }}
            >{h}</div>
          ))}
          <div className="stg-history-clear" onMouseDown={() => { clearFieldHistory(fieldKey); setOpen(false); }}>
            清除历史
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function getInitialStaff() {
  const displayName = localStorage.getItem('xingbao_display_name')?.trim();
  if (displayName && !DEFAULT_STAFF_BASE.includes(displayName)) {
    return [displayName, ...DEFAULT_STAFF_BASE];
  }
  return DEFAULT_STAFF_BASE;
}

function loadCustom(key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveCustom(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

const TEXT_FIELDS = [
  { key: 'shelf_number', label: '货架号（第几列）', placeholder: '请输入货架号', required: true, accent: 'cyan', hasHistory: true },
  { key: 'grid_number', label: '格子', placeholder: '请输入格子编号', accent: 'cyan', hasHistory: true },
  { key: 'product_code', label: '货号', placeholder: '请输入货号', accent: 'purple', hasHistory: true },
  { key: 'stamp_code', label: '移印编号', placeholder: '请输入移印编号', required: true, accent: 'cyan', hasHistory: true },
];

// 全部参与"重复判定"与"Enter 跳转"的字段顺序（保持录入顺序）
const FIELD_ORDER = ['shelf_number', 'grid_number', 'product_code', 'stamp_code', 'sales_channel', 'staff_name'];
const FIELD_LABELS = {
  shelf_number: '货架号（第几列）',
  grid_number: '格子',
  product_code: '货号',
  stamp_code: '移印编号',
  sales_channel: '销售列',
  staff_name: '仓储人员',
};

export default function Storage({ onStatsChange, onBackHome }) {
  const [form, setForm] = useState(() => {
    const displayName = localStorage.getItem('xingbao_display_name')?.trim();
    const staffOptions = getInitialStaff();
    if (displayName && staffOptions.includes(displayName)) {
      return { ...INITIAL_FORM, staff_name: displayName };
    }
    return { ...INITIAL_FORM };
  });

  // 受控的销售选项（保留本地存储 + 默认值）
  const [salesOptions, setSalesOptions] = useState(() => [...DEFAULT_SALES, ...loadCustom(LS_KEY.sales)]);

  // 人员列表：从 Supabase 加载（实时同步）
  const [staffList, setStaffList] = useState([]); // [{id, name, is_default}, ...]
  const [staffLoading, setStaffLoading] = useState(true);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [dragOver, setDragOver] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(null);
  const fileRef = useRef(null);
  const excelRef = useRef(null);
  const subRef = useRef(null);

  // 字段引用（用于 Enter 键跳转焦点）
  const fieldRefs = {
    shelf_number: useRef(null),
    grid_number: useRef(null),
    product_code: useRef(null),
    stamp_code: useRef(null),
    sales_channel: useRef(null),
    staff_name: useRef(null),
  };
  const dupTimer = useRef(null);
  const lastDupSig = useRef('');

  // 初始化：首次填充默认人员 + 订阅实时变化
  useEffect(() => {
    let cancelled = false;
    async function initStaff() {
      try {
        // 先尝试填充默认人员（如果表为空）
        await seedDefaultStaff(DEFAULT_STAFF_BASE);
        // 加载人员列表
        const { data, error } = await fetchStaffList();
        if (cancelled) return;
        if (!error && data) {
          setStaffList(data);
        } else {
          // 失败时回退到本地
          const local = [...getInitialStaff(), ...loadCustom(LS_KEY.staff)];
          setStaffList(local.map((name, idx) => ({ id: `local-${idx}`, name, is_default: DEFAULT_STAFF_BASE.includes(name) })));
        }
      } catch (e) {
        if (cancelled) return;
        // 网络错误时回退到本地
        const local = [...getInitialStaff(), ...loadCustom(LS_KEY.staff)];
        setStaffList(local.map((name, idx) => ({ id: `local-${idx}`, name, is_default: DEFAULT_STAFF_BASE.includes(name) })));
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }
    initStaff();

    // 订阅实时变化
    subRef.current = subscribeToStaffList(async () => {
      const { data } = await fetchStaffList();
      if (data && !cancelled) setStaffList(data);
    });

    return () => {
      cancelled = true;
      subRef.current?.unsubscribe?.();
    };
  }, []);

  // 从 Supabase 数据派生选项列表
  const staffOptions = useMemo(() => staffList.map(s => s.name), [staffList]);

  // 全部字段填写完成后，自动检测数据库是否存在相同记录 → 弹窗审查
  useEffect(() => {
    const filled = FIELD_ORDER.every(k => (form[k] || '').toString().trim() !== '');
    const sig = FIELD_ORDER.map(k => (form[k] || '').toString().trim().toLowerCase()).join('\u0001');
    if (!filled) {
      lastDupSig.current = '';
      return;
    }
    if (sig === lastDupSig.current) return;
    lastDupSig.current = sig;
    if (dupTimer.current) clearTimeout(dupTimer.current);
    dupTimer.current = setTimeout(async () => {
      const existing = await findDuplicate();
      if (existing) {
        setReviewModal({ existing, onConfirm: () => doSave(buildSubmitData()) });
      }
    }, 450);
    return () => { if (dupTimer.current) clearTimeout(dupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.shelf_number, form.grid_number, form.product_code, form.stamp_code, form.sales_channel, form.staff_name]);

  // 同步销售选项到 localStorage
  function updateSalesOptions(next) {
    setSalesOptions(next);
    const custom = next.filter(o => !DEFAULT_SALES.includes(o));
    saveCustom(LS_KEY.sales, custom);
  }

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function focusNextField(key) {
    const idx = FIELD_ORDER.indexOf(key);
    const next = FIELD_ORDER[idx + 1];
    if (next && fieldRefs[next]?.current) {
      fieldRefs[next].current.focus?.();
    }
  }

  // 判断两条记录是否在全部关键字段上相同（忽略大小写与首尾空格）
  function isSameRecord(a, b) {
    return FIELD_ORDER.every(
      k => (a[k] || '').toString().trim().toLowerCase() === (b[k] || '').toString().trim().toLowerCase()
    );
  }

  function buildSubmitData() {
    const now = new Date().toISOString();
    const submitData = { ...form, created_at: now, updated_at: now };
    if (!submitData.image_url) delete submitData.image_url;
    return submitData;
  }

  async function findDuplicate() {
    const { data } = await fetchItems({ shelf_number: form.shelf_number });
    const list = (data || []).filter(item => isSameRecord(item, form));
    return list[0] || null;
  }

  async function handleImageUpload(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('图片大小不能超过 10MB', 'error');
      return;
    }
    setUploading(true);
    const { data: url, error } = await uploadImage(file);
    setUploading(false);
    if (!error && url) {
      setForm(prev => ({ ...prev, image_url: url }));
      showToast('图片上传成功', 'success');
    } else {
      showToast('上传失败: ' + (error?.message || '未知错误'), 'error');
    }
  }

  function removeImage() {
    setForm(prev => ({ ...prev, image_url: '' }));
  }

  function handleFilePick(e) {
    handleImageUpload(e.target.files?.[0]);
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleImageUpload(e.dataTransfer?.files?.[0]);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  // Excel 导入
  async function handleExcelImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      showToast('请选择 .xlsx / .xls / .csv 格式文件', 'error');
      e.target.value = '';
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows || rows.length === 0) { showToast('Excel 文件中无数据', 'error'); return; }
      const now = new Date().toISOString();
      let successCount = 0, failCount = 0;
      for (const row of rows) {
        const item = {
          shelf_number: String(row['货架号'] || row['shelf_number'] || row['货架编号'] || row['货架号（第几列）'] || '').trim(),
          stamp_code: String(row['移印编号'] || row['stamp_code'] || row['印章编号'] || '').trim(),
          sales_channel: String(row['销售列'] || row['销售'] || row['sales_channel'] || row['销售渠道'] || '').trim(),
          staff_name: String(row['仓储人员'] || row['人员'] || row['staff_name'] || row['人员姓名'] || '').trim(),
          grid_number: String(row['格子'] || row['grid_number'] || row['网格号'] || '').trim(),
          product_code: String(row['货号'] || row['产品货号'] || row['product_code'] || row['产品编码'] || '').trim(),
          image_url: String(row['图片链接'] || row['image_url'] || '').trim(),
          created_at: now, updated_at: now,
        };
        if (!item.shelf_number && !item.stamp_code) continue;
        if (!item.shelf_number || !item.stamp_code) { failCount++; continue; }
        Object.keys(item).forEach(k => { if (item[k] === '' || item[k] === undefined) delete item[k]; });
        const { error } = await insertItem(item);
        error ? failCount++ : successCount++;
      }
      showToast(`导入完成：成功 ${successCount} 条，失败 ${failCount} 条（共 ${rows.length} 条）`, failCount > 0 ? 'error' : 'success');
      onStatsChange?.();
    } catch (e) {
      showToast('Excel 解析失败: ' + (e.message || '未知错误'), 'error');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    if (!form.shelf_number || !form.stamp_code) {
      showToast('请填写货架号（第几列）和移印编号', 'error');
      return;
    }
    const existing = await findDuplicate();
    if (existing) {
      setReviewModal({ existing, onConfirm: () => doSave(buildSubmitData()) });
      return;
    }
    doSave(buildSubmitData());
  }

  async function doSave(submitData) {
    setLoading(true);
    const { error } = await insertItem(submitData);
    setLoading(false);
    if (!error) {
      TEXT_FIELDS.forEach(field => {
        if (field.hasHistory) addFieldHistory(field.key, form[field.key]);
      });
      showToast('✓ 样品信息保存成功', 'success');
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 4000);
      setForm({ ...INITIAL_FORM });
      onStatsChange?.();
    } else {
      showToast('保存失败: ' + error.message, 'error');
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 4000);
    }
  }

  function handleReset() {
    setForm({ ...INITIAL_FORM });
    showToast('已重置工单', 'success');
    onBackHome?.();
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <>
      {toast && <div className={`stg-toast stg-toast--${toast.type}`}>{toast.msg}</div>}
      <div className="stg-page">

      {/* ===== Top Bar ===== */}
      <div className="stg-topbar">
        <button className="stg-btn-back" onClick={handleReset} title="返回首页">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
          <span>返回首页</span>
        </button>
        <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} style={{ display: 'none' }} />
        <button className="stg-btn-import" onClick={() => excelRef.current?.click()} disabled={importing}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <span>{importing ? '导入中...' : '导入 Excel'}</span>
        </button>
      </div>

      {/* ===== Main Card ===== */}
      <div className="stg-card">
        {/* Header */}
        <div className="stg-card-head">
          <div className="stg-dots">
            <span className="stg-dot stg-dot--cyan" />
            <span className="stg-dot stg-dot--cyan" />
            <span className="stg-dot stg-dot--purple" />
          </div>
          <h1 className="stg-title">移印签板样品工单</h1>
          <p className="stg-subtitle">请填写完整的样品信息</p>
        </div>

        {/* Form */}
        <div className="stg-form">
          {TEXT_FIELDS.map((field, i) => (
            <div key={field.key} className={`stg-field stg-field--${field.accent} stg-stagger`} style={{ animationDelay: `${0.08 + i * 0.05}s` }}>
              <label className="stg-field-label">
                {field.label}
                {field.required && <span className="stg-field-required">*</span>}
              </label>
              {field.hasHistory ? (
                <HistoryInput
                  value={form[field.key]}
                  onChange={v => updateField(field.key, v)}
                  placeholder={field.placeholder}
                  fieldKey={field.key}
                  inputRef={fieldRefs[field.key]}
                  onEnter={() => focusNextField(field.key)}
                />
              ) : (
                <div className="stg-field-input-wrap">
                  <input
                    type="text"
                    className="stg-field-input"
                    value={form[field.key]}
                    ref={fieldRefs[field.key]}
                    onChange={e => updateField(field.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        focusNextField(field.key);
                      }
                    }}
                    placeholder={field.placeholder}
                  />
                </div>
              )}
            </div>
          ))}

          {/* 销售列 */}
          <div className="stg-stagger" style={{ animationDelay: `${0.08 + 4 * 0.05}s` }}>
            <SelectField
              label="销售列"
              defaultOptions={DEFAULT_SALES}
              options={salesOptions}
              onOptionsChange={updateSalesOptions}
              value={form.sales_channel}
              onChange={v => updateField('sales_channel', v)}
              placeholder="请选择销售"
              required
              accent="cyan"
              externalTriggerRef={fieldRefs.sales_channel}
              onAfterSelect={() => focusNextField('sales_channel')}
            />
          </div>

          {/* 仓储人员（带"管理人员"角标） */}
          <div
            className="stg-stagger stg-field-with-badge"
            style={{ animationDelay: `${0.08 + 5 * 0.05}s` }}
          >
            <SelectField
              label="仓储人员"
              options={staffOptions}
              value={form.staff_name}
              onChange={v => updateField('staff_name', v)}
              placeholder={staffLoading ? '加载中...' : '请选择仓储人员'}
              required
              accent="purple"
              externalTriggerRef={fieldRefs.staff_name}
            />
            <span
              className="stg-badge"
              onClick={(e) => { e.stopPropagation(); setShowStaffModal(true); }}
              title="管理人员"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              管理人员
            </span>
          </div>

          {/* 上传图片 */}
          <div className={`stg-field stg-field--cyan stg-stagger`} style={{ animationDelay: `${0.08 + 6 * 0.05}s` }}>
            <label className="stg-field-label">上传图片</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFilePick} style={{ display: 'none' }} />
            {form.image_url ? (
              <div className="stg-upload-row">
                <div className="stg-upload-preview">
                  <img src={form.image_url} alt="样品预览" className="stg-upload-img" />
                  <button type="button" className="stg-upload-remove" onClick={removeImage} title="移除图片">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
                <button type="button" className="stg-upload-change" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? '⏳ 上传中...' : '📷 更换图片'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`stg-upload-btn ${dragOver ? 'stg-upload-btn--drag' : ''} ${uploading ? 'stg-upload-btn--loading' : ''}`}
                onClick={() => !uploading && fileRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                disabled={uploading}
              >
                {uploading ? (
                  <><span className="stg-upload-spinner" />正在上传...</>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span>选择图片文件</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="stg-actions">
            <button className="stg-btn stg-btn--save" onClick={handleSave} disabled={loading}>
              {loading ? (
                <><span className="stg-btn-spinner" />保存中...</>
              ) : (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>保存数据</span></>
              )}
            </button>
            <button className="stg-btn stg-btn--reset" onClick={handleReset} disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              <span>重置工单</span>
            </button>
          </div>
        </div>
      </div>

      {/* Background decor */}
      <div className="stg-bg-decor" aria-hidden="true">
        <div className="stg-bg-grid" />
      </div>

      {/* ===== 重复记录审查弹窗 ===== */}
      {reviewModal && (
        <ReviewModal
          existing={reviewModal.existing}
          form={form}
          onConfirm={reviewModal.onConfirm}
          onCancel={() => setReviewModal(null)}
        />
      )}

      {/* ===== 人员管理弹窗 ===== */}
      {showStaffModal && (
        <StaffManagementModal
          list={staffList}
          onClose={() => setShowStaffModal(false)}
          onAdd={async (name) => {
            const { error } = await addStaffMember(name);
            if (error) {
              showToast(error.message || '添加失败', 'error');
              return false;
            }
            showToast('✓ 已添加人员', 'success');
            return true;
          }}
          onDelete={async (id) => {
            const { error } = await deleteStaffMember(id);
            if (error) {
              showToast(error.message || '删除失败', 'error');
              return false;
            }
            showToast('✓ 已删除人员', 'success');
            return true;
          }}
        />
      )}
    </div>
    </>
  );
}

// ===== 重复记录审查弹窗（展示数据库已有值 vs 当前输入对比） =====
function ReviewModal({ existing, form, onConfirm, onCancel }) {
  const rows = FIELD_ORDER.map(key => {
    const inputVal = (form[key] || '').toString();
    const dbVal = (existing[key] || '').toString();
    const differ = inputVal.trim().toLowerCase() !== dbVal.trim().toLowerCase();
    return { key, label: FIELD_LABELS[key], inputVal, dbVal, differ };
  });
  const allSame = rows.every(r => !r.differ);
  return (
    <div className="stg-confirm-overlay" onClick={onCancel}>
      <div className="stg-confirm-modal stg-review-modal" onClick={e => e.stopPropagation()}>
        <h3 className="stg-confirm-title">
          {allSame ? '检测到完全相同的记录' : '数据库中存在相似记录，请审查'}
        </h3>
        <p className="stg-confirm-message">
          以下为「您当前输入」与「数据库已有记录」的逐项对比，请确认后再保存。
        </p>
        <div className="stg-review-table">
          <div className="stg-review-head">
            <div className="stg-review-col">字段</div>
            <div className="stg-review-col">您当前输入</div>
            <div className="stg-review-col">数据库已有</div>
          </div>
          {rows.map(r => (
            <div key={r.key} className={`stg-review-row ${r.differ ? 'stg-review-row--diff' : ''}`}>
              <div className="stg-review-col stg-review-label">{r.label}</div>
              <div className="stg-review-col">{r.inputVal || <span className="stg-review-empty">（空）</span>}</div>
              <div className="stg-review-col">{r.dbVal || <span className="stg-review-empty">（空）</span>}</div>
            </div>
          ))}
        </div>
        <div className="stg-confirm-actions">
          <button className="stg-confirm-btn stg-confirm-btn--cancel" onClick={onCancel}>返回修改</button>
          <button className="stg-confirm-btn stg-confirm-btn--confirm" onClick={onConfirm}>确认保存</button>
        </div>
      </div>
    </div>
  );
}

// ===== 人员管理弹窗组件 =====
function StaffManagementModal({ list: initialList, onClose, onAdd, onDelete }) {
  const [list, setList] = useState(initialList);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  // 同步外部列表变化（实时订阅）
  useEffect(() => { setList(initialList); }, [initialList]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const ok = await onAdd(name);
    setBusy(false);
    if (ok) {
      setNewName('');
      inputRef.current?.focus();
    }
  }

  async function handleDelete(member) {
    if (busy) return;
    if (!confirm(`确定删除「${member.name}」？`)) return;
    setBusy(true);
    await onDelete(member.id);
    setBusy(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="stf-modal-overlay" onClick={onClose}>
      <div className="stf-modal" onClick={e => e.stopPropagation()}>
        <div className="stf-modal-head">
          <div>
            <h2 className="stf-modal-title">人员管理</h2>
            <p className="stf-modal-subtitle">添加或删除仓储人员（所有用户实时同步）</p>
          </div>
          <button className="stf-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="stf-modal-section">
          <label className="stf-section-label">添加新人员</label>
          <div className="stf-add-row">
            <input
              ref={inputRef}
              type="text"
              className="stf-add-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入姓名"
              maxLength={20}
              disabled={busy}
            />
            <button
              type="button"
              className="stf-add-btn"
              onClick={handleAdd}
              disabled={!newName.trim() || busy}
            >
              {busy ? (
                <span className="stf-btn-spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              )}
              添加
            </button>
          </div>
        </div>

        <div className="stf-modal-section">
          <label className="stf-section-label">当前人员列表（{list.length}）</label>
          <div className="stf-staff-list">
            {list.map(member => {
              return (
                <div key={member.id} className="stf-staff-item">
                  <span className="stf-staff-name">{member.name}</span>
                  <button
                    type="button"
                    className="stf-staff-delete"
                    onClick={() => handleDelete(member)}
                    disabled={busy}
                    title={`删除「${member.name}」`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              );
            })}
            {list.length === 0 && (
              <div className="stf-staff-empty">暂无人员，请添加</div>
            )}
          </div>
        </div>

        <div className="stf-modal-foot">
          <button className="stf-done-btn" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
