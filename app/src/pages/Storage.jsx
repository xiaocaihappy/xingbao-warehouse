import { useState, useRef, useMemo, useEffect } from 'react';
import { insertItem, uploadImage } from '../supabase';
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

// 获取含当前登录用户名的完整人员列表
function getDefaultStaff() {
  const displayName = localStorage.getItem('xingbao_display_name')?.trim();
  if (displayName && !DEFAULT_STAFF_BASE.includes(displayName)) {
    return [displayName, ...DEFAULT_STAFF_BASE];
  }
  return DEFAULT_STAFF_BASE;
}

// 普通文本输入字段
const TEXT_FIELDS = [
  { key: 'shelf_number', label: '货架号（第几列）', placeholder: '请输入货架列号', required: true, accent: 'amber' },
  { key: 'grid_number', label: '格子', placeholder: '请输入格子编号', accent: 'teal' },
  { key: 'product_code', label: '货号', placeholder: '请输入产品货号', accent: 'blue' },
  { key: 'stamp_code', label: '移印编号', placeholder: '请输入移印编号', required: true, accent: 'rose' },
];

export default function Storage({ onStatsChange, onBackHome }) {
  const [form, setForm] = useState(() => {
    const displayName = localStorage.getItem('xingbao_display_name')?.trim();
    const staffOptions = getDefaultStaff();
    if (displayName && staffOptions.includes(displayName)) {
      return { ...INITIAL_FORM, staff_name: displayName };
    }
    return { ...INITIAL_FORM };
  });
  const DEFAULT_STAFF = useMemo(() => getDefaultStaff(), []);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const excelRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
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
    setLoading(true);
    const now = new Date().toISOString();
    const submitData = { ...form, created_at: now, updated_at: now };
    if (!submitData.image_url) delete submitData.image_url;
    const { error } = await insertItem(submitData);
    setLoading(false);
    if (!error) {
      showToast('✓ 样品信息保存成功', 'success');
      setForm({ ...INITIAL_FORM });
      onStatsChange?.();
    } else {
      showToast('保存失败: ' + error.message, 'error');
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

  const staggerDelay = (i) => ({ animationDelay: `${0.08 + i * 0.06}s` });

  return (
    <div className={`stg-page ${mounted ? 'stg-mounted' : ''}`}>
      {toast && <div className={`stg-toast stg-toast--${toast.type}`}>{toast.msg}</div>}

      {/* ===== Header ===== */}
      <header className="stg-header">
        <div className="stg-header-top">
          <button className="stg-btn-back" onClick={handleReset} title="返回首页">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
            <span>返回</span>
          </button>
          <div className="stg-header-brand">
            <div className="stg-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <div className="stg-header-text">
              <h1 className="stg-title">移印签板样品工单</h1>
              <p className="stg-subtitle">录入新的样品信息至仓储系统</p>
            </div>
          </div>
          <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} style={{ display: 'none' }} />
          <button className="stg-btn-import" onClick={() => excelRef.current?.click()} disabled={importing}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>{importing ? '导入中...' : '导入 Excel'}</span>
          </button>
        </div>
        <div className="stg-header-wave">
          <svg preserveAspectRatio="none" viewBox="0 0 1440 48" width="1440" height="48"><path d="M0 48h1440V24c-240-32-480-32-720 0S480 56 240 48 80 40 0 48z" fill="currentColor" opacity="0.06"/></svg>
        </div>
      </header>

      {/* ===== Form ===== */}
      <div className="stg-form">

        {/* Section 1: 样品信息 */}
        <section className="stg-section" style={staggerDelay(0)}>
          <div className="stg-section-head">
            <div className="stg-section-dot" />
            <h2 className="stg-section-title">样品信息</h2>
            <div className="stg-section-line" />
          </div>
          <div className="stg-section-grid">
            {TEXT_FIELDS.map((field, i) => (
              <div key={field.key} className={`stg-field stg-field--${field.accent}`} style={staggerDelay(i + 1)}>
                <label className="stg-field-label">
                  {field.label}
                  {field.required && <span className="stg-field-required">*</span>}
                </label>
                <div className="stg-field-wrap">
                  <input
                    type="text"
                    className="stg-field-input"
                    value={form[field.key]}
                    onChange={e => updateField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                  />
                  <div className="stg-field-bar" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: 渠道与人员 */}
        <section className="stg-section" style={staggerDelay(5)}>
          <div className="stg-section-head">
            <div className="stg-section-dot" />
            <h2 className="stg-section-title">渠道与人员</h2>
            <div className="stg-section-line" />
          </div>
          <div className="stg-section-grid">
            <SelectField
              label="销售列"
              defaultOptions={DEFAULT_SALES}
              storageKey="sales_channel"
              value={form.sales_channel}
              onChange={v => updateField('sales_channel', v)}
              placeholder="请选择销售渠道"
              required
              accent="amber"
            />
            <SelectField
              label="仓储人员"
              defaultOptions={DEFAULT_STAFF}
              storageKey="staff_name"
              value={form.staff_name}
              onChange={v => updateField('staff_name', v)}
              placeholder="请选择仓储人员"
              required
              accent="rose"
            />
          </div>
        </section>

        {/* Section 3: 样品图片 */}
        <section className="stg-section" style={staggerDelay(6)}>
          <div className="stg-section-head">
            <div className="stg-section-dot" />
            <h2 className="stg-section-title">样品图片</h2>
            <div className="stg-section-line" />
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFilePick} style={{ display: 'none' }} />
          {form.image_url ? (
            <div className="stg-preview">
              <div className="stg-preview-img-wrap">
                <img src={form.image_url} alt="样品预览" className="stg-preview-img" />
                <div className="stg-preview-overlay">
                  <button type="button" className="stg-preview-btn stg-preview-btn--change" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span>{uploading ? '上传中...' : '更换'}</span>
                  </button>
                  <button type="button" className="stg-preview-btn stg-preview-btn--remove" onClick={removeImage}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <span>删除</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`stg-upload ${dragOver ? 'stg-upload--drag' : ''} ${uploading ? 'stg-upload--loading' : ''}`}
              onClick={() => !uploading && fileRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
            >
              <div className="stg-upload-icon">
                {uploading ? (
                  <div className="stg-upload-spinner" />
                ) : (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                )}
                {dragOver && <div className="stg-upload-glow" />}
              </div>
              <div className="stg-upload-text">
                <strong>{uploading ? '正在上传...' : '点击选择或拖拽图片到此'}</strong>
                <small>支持 JPG / PNG，单个文件不超过 10MB</small>
              </div>
            </div>
          )}
        </section>

        {/* ===== Footer Actions ===== */}
        <div className="stg-actions" style={staggerDelay(7)}>
          <button className="stg-btn stg-btn--save" onClick={handleSave} disabled={loading}>
            {loading ? (
              <><div className="stg-btn-spinner" /><span>保存中...</span></>
            ) : (
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>保存数据</span></>
            )}
          </button>
          <button className="stg-btn stg-btn--reset" onClick={handleReset} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>重置工单</span>
          </button>
        </div>
      </div>

      {/* ===== Background Decor ===== */}
      <div className="stg-bg-decor" aria-hidden="true">
        <div className="stg-bg-grid" />
        <div className="stg-bg-orb stg-bg-orb--1" />
        <div className="stg-bg-orb stg-bg-orb--2" />
      </div>
    </div>
  );
}
