import { useState, useRef, useMemo } from 'react';
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
  { key: 'shelf_number', label: '货架号（第几列）', placeholder: '请输入货架列号', required: true, accent: 'blue' },
  { key: 'grid_number', label: '格子', placeholder: '请输入格子编号', accent: 'cyan' },
  { key: 'product_code', label: '货号', placeholder: '请输入产品货号', accent: 'orange' },
  { key: 'stamp_code', label: '移印编号', placeholder: '请输入移印编号', required: true, accent: 'purple' },
];

export default function Storage({ onStatsChange, onBackHome }) {
  const [form, setForm] = useState(() => {
    // 自动填入当前登录用户名称到仓储人员
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
  const fileRef = useRef(null);
  const excelRef = useRef(null);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
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

      if (!rows || rows.length === 0) {
        showToast('Excel 文件中无数据', 'error');
        return;
      }

      const now = new Date().toISOString();
      let successCount = 0;
      let failCount = 0;
      const total = rows.length;

      for (const row of rows) {
        const item = {
          shelf_number: String(row['货架号'] || row['shelf_number'] || row['货架编号'] || row['货架号（第几列）'] || '').trim(),
          stamp_code: String(row['移印编号'] || row['stamp_code'] || row['印章编号'] || '').trim(),
          sales_channel: String(row['销售列'] || row['销售'] || row['sales_channel'] || row['销售渠道'] || '').trim(),
          staff_name: String(row['仓储人员'] || row['人员'] || row['staff_name'] || row['人员姓名'] || '').trim(),
          grid_number: String(row['格子'] || row['grid_number'] || row['网格号'] || '').trim(),
          product_code: String(row['货号'] || row['产品货号'] || row['product_code'] || row['产品编码'] || '').trim(),
          image_url: String(row['图片链接'] || row['image_url'] || '').trim(),
          created_at: now,
          updated_at: now,
        };

        if (!item.shelf_number && !item.stamp_code) continue;

        if (!item.shelf_number || !item.stamp_code) {
          failCount++;
          continue;
        }

        Object.keys(item).forEach(k => {
          if (item[k] === '' || item[k] === undefined) delete item[k];
        });

        const { error } = await insertItem(item);
        if (error) {
          failCount++;
        } else {
          successCount++;
        }
      }

      showToast(
        `导入完成：成功 ${successCount} 条，失败 ${failCount} 条（共 ${total} 条）`,
        failCount > 0 ? 'error' : 'success'
      );
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
    const submitData = {
      ...form,
      created_at: now,
      updated_at: now,
    };
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

  return (
    <div className="storage-page-v2">
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* 标题区域 */}
      <div className="page-header">
        <div className="header-dots">
          <span /><span /><span />
        </div>
        <h1 className="header-title">移印签板样品工单</h1>
        <p className="header-subtitle">请填写完整的样品信息</p>
      </div>

      {/* 顶部操作栏 */}
      <div className="header-actions">
        <button className="btn btn-ghost" onClick={handleReset}>
          ← 返回首页
        </button>
        <input
          ref={excelRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelImport}
          style={{ display: 'none' }}
        />
        <button
          className="btn btn-outline-accent"
          onClick={() => excelRef.current?.click()}
          disabled={importing}
        >
          📥 {importing ? '导入中...' : '导入 Excel'}
        </button>
      </div>

      {/* 表单区域 */}
      <div className="work-order-form">
        <div className="form-columns">
          {/* 文本输入字段 */}
          {TEXT_FIELDS.map(field => (
            <div key={field.key} className={`field-group field-accent-${field.accent}`}>
              <label className="field-label">
                {field.label}
                {field.required && <span className="field-required"> *</span>}
              </label>
              <input
                type="text"
                className="field-input"
                value={form[field.key]}
                onChange={e => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          ))}

          {/* 销售列 - 下拉选择 */}
          <SelectField
            label="销售列"
            defaultOptions={DEFAULT_SALES}
            storageKey="sales_channel"
            value={form.sales_channel}
            onChange={v => updateField('sales_channel', v)}
            placeholder="请选择销售渠道"
            required
            accent="green"
          />

          {/* 仓储人员 - 下拉选择 */}
          <SelectField
            label="仓储人员"
            defaultOptions={DEFAULT_STAFF}
            storageKey="staff_name"
            value={form.staff_name}
            onChange={v => updateField('staff_name', v)}
            placeholder="请选择仓储人员"
            required
            accent="pink"
          />
        </div>

        {/* 图片上传 */}
        <div className="field-group field-accent-teal" style={{ marginTop: 20 }}>
          <label className="field-label">上传图片</label>
          <div className="upload-section">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            {form.image_url ? (
              <div className="upload-preview-row">
                <img src={form.image_url} alt="样品预览" className="upload-preview-img" />
                <div className="upload-preview-actions">
                  <button type="button" className="btn btn-sm btn-outline-accent" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? '⏳ 上传中...' : '📷 更换图片'}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost-danger" onClick={removeImage}>
                    🗑 移除
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="upload-trigger" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <span className="upload-trigger-icon">{uploading ? '⏳' : '📁'}</span>
                <div className="upload-trigger-text">
                  <strong>{uploading ? '正在上传...' : '选择图片文件'}</strong>
                  <small>支持 JPG / PNG，单个文件不超过 10MB</small>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="form-footer">
          <button className="btn btn-primary-glow" onClick={handleSave} disabled={loading}>
            {loading ? '⏳ 保存中...' : '💾 保存数据'}
          </button>
          <button type="button" className="btn btn-outline" onClick={handleReset}>
            🔄 重置工单
          </button>
        </div>
      </div>
    </div>
  );
}
