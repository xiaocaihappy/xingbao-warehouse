import { useState, useEffect } from 'react';
import { fetchItems, updateItem, deleteItem, subscribeToItems, uploadImage } from '../supabase';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const PAGE_SIZE = 12;

export default function Query({ onStatsChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);

  useEffect(() => {
    loadItems();
    let sub = null;
    try { sub = subscribeToItems(() => loadItems()); }
    catch (e) { console.error('实时订阅初始化失败:', e); }
    return () => { sub?.unsubscribe?.(); };
  }, []);

  useEffect(() => { setPage(1); loadItems(); }, [search, yearFilter, channelFilter]);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (search) filters.search = search;
      if (channelFilter) filters.sales_channel = channelFilter;

      const { data, error: fetchError } = await fetchItems(filters);
      if (fetchError) {
        setError(fetchError.message || '数据加载失败');
        setItems([]);
      } else if (Array.isArray(data)) {
        // 年份过滤（客户端）
        if (yearFilter) {
          setItems(data.filter(d => d.created_at?.startsWith(yearFilter)));
        } else {
          setItems(data);
        }
      } else {
        setItems([]);
      }
    } catch (e) {
      setError(e.message || '加载异常');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // 选择
  function toggleSelect(id) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
    setSelectAll(next.size === safeItems.length && safeItems.length > 0);
  }

  function toggleSelectAll() {
    if (selectAll) { setSelectedIds(new Set()); setSelectAll(false); }
    else { setSelectedIds(new Set(safeItems.map(i => i.id))); setSelectAll(true); }
  }

  // 删除
  async function handleDelete(id) {
    if (!confirm('确定删除该记录？此操作不可撤销。')) return;
    const { error: err } = await deleteItem(id);
    if (!err) { showToast('已删除', 'success'); loadItems(); onStatsChange?.(); }
    else { showToast('删除失败: ' + err.message, 'error'); }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) { showToast('请先选择要删除的记录', 'error'); return; }
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录？此操作不可撤销。`)) return;
    let failed = 0;
    for (const id of selectedIds) {
      const { error: err } = await deleteItem(id);
      if (err) failed++;
    }
    setSelectedIds(new Set());
    setSelectAll(false);
    showToast(`删除完成${failed > 0 ? `（${failed} 条失败）` : ''}`, failed > 0 ? 'error' : 'success');
    loadItems();
    onStatsChange?.();
  }

  // 编辑
  async function handleEdit() {
    const { id, ...updates } = editModal;
    const { error: err } = await updateItem(id, updates);
    if (!err) { showToast('更新成功', 'success'); setEditModal(null); loadItems(); onStatsChange?.(); }
    else { showToast('更新失败: ' + err.message, 'error'); }
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { data: url, error: err } = await uploadImage(file);
    if (!err && url) { setEditModal(prev => ({ ...prev, image_url: url })); }
    else { showToast('图片上传失败', 'error'); }
  }

  // 导出全部数据（Excel .xlsx 含嵌入图片，通过主进程生成）
  async function exportCSV() {
    if (safeItems.length === 0) { showToast('无数据可导出', 'error'); return; }
    const dateStr = new Date().toISOString().slice(0, 10);

    // 准备数据（不含图片 buffer，只传 URL 由主进程下载）
    const items = safeItems.map(i => ({
      id: i.id,
      shelf_number: i.shelf_number,
      stamp_code: i.stamp_code,
      sales_channel: i.sales_channel,
      staff_name: i.staff_name,
      grid_number: i.grid_number,
      product_code: i.product_code,
      image_url: i.image_url,
      created_at: i.created_at,
    }));

    const withImagesCount = items.filter(i => i.image_url && i.image_url !== 'EMPTY').length;
    showToast(`正在生成 Excel${withImagesCount > 0 ? '（含 ' + withImagesCount + ' 张图片）' : ''}...`, 'success');

    try {
      const result = await window.electronAPI.exportExcel(items);
      if (!result.success) {
        showToast('Excel 生成失败: ' + (result.error || '未知错误'), 'error');
        return;
      }

      // 创建 Blob 并触发下载
      const blob = new Blob([result.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `星堡移印样品_${dateStr}.xlsx`;
      link.click();

      showToast(`已导出 ${safeItems.length} 条数据（含图片的 .xlsx）`, 'success');
    } catch (e) {
      showToast('导出失败: ' + (e.message || '未知错误'), 'error');
    }
  }

  function exportImages() {
    const withImages = safeItems.filter(i => i.image_url && i.image_url !== 'EMPTY');
    if (withImages.length === 0) { showToast('没有可导出的图片', 'error'); return; }
    const html = `<html><body style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px;background:#0f131a;">
      ${withImages.map((i, idx) => `<div style="text-align:center;color:#fff;font-size:12px;">
        <img src="${i.image_url}" style="width:100%;border-radius:8px;" onerror="this.style.display='none'" />
        <p>${i.stamp_code} / ${i.shelf_number}</p></div>`).join('')}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `星堡图片预览_${new Date().toISOString().slice(0, 10)}.html`;
    link.click();
    showToast(`已导出 ${withImages.length} 张图片预览`, 'success');
  }

  function exportSelected() {
    if (selectedIds.size === 0) { showToast('请先选择记录', 'error'); return; }
    const selected = safeItems.filter(i => selectedIds.has(i.id));
    const headers = ['货架号', '移印编号', '销售', '人员', '格子号', '产品货号'];
    const rows = selected.map(i => [i.shelf_number, i.stamp_code, i.sales_channel, i.staff_name, i.grid_number, i.product_code]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `星堡选中数据_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showToast(`已导出 ${selected.length} 条记录`, 'success');
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const safeItems = Array.isArray(items) ? items : [];
  const totalPages = Math.ceil(safeItems.length / PAGE_SIZE);
  const pagedItems = safeItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 渠道列表和年份列表
  const channels = [...new Set(safeItems.map(i => i?.sales_channel).filter(Boolean))].sort();
  const years = [...new Set(safeItems.map(i => i?.created_at?.slice(0, 4)).filter(Boolean))].sort().reverse();

  return (
    <div className="query-page-v2">
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* 标题区域 */}
      <div className="page-header">
        <div className="header-dots">
          <span /><span /><span />
        </div>
        <h1 className="header-title">查询移印样品</h1>
        <p className="header-subtitle">支持按移印编号、人员、销售、货架号等维度快速检索样品信息</p>
      </div>

      {/* 搜索及筛选 */}
      <div className="search-section">
        <div className="search-row">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              className="search-input-v2"
              type="text"
              placeholder="搜索移印编号、人员姓名、销售、货架号..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary-glow" onClick={loadItems}>查询</button>
        </div>
        <div className="filter-row">
          <select className="filter-select" value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
            <option value="">全部渠道</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filter-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
            <option value="">全部年份</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="action-bar">
        <button className="btn btn-outline btn-sm" onClick={exportCSV} title="导出Excel .xlsx（图片嵌入表格）">
          <span className="btn-icon">📊</span> 导出Excel(含图片)
        </button>
        <button className="btn btn-outline btn-sm" onClick={exportImages} title="生成图片预览 HTML">
          <span className="btn-icon">🖼</span> 导出所有图片
        </button>
        <button className="btn btn-outline btn-sm" onClick={exportSelected} disabled={selectedIds.size === 0} title="导出选中项">
          <span className="btn-icon">📋</span> 导出选中结果
        </button>
        <button
          className="btn btn-sm"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', marginLeft: 'auto' }}
          onClick={handleBatchDelete}
          disabled={selectedIds.size === 0}
        >
          🗑 删除选中 ({selectedIds.size})
        </button>
      </div>

      {/* 数据表格 */}
      <div className="table-container-v2">
        {loading ? (
          <div className="loading"><div className="spinner" />数据加载中...</div>
        ) : error ? (
          <div className="empty-state">
            <div className="icon">⚠️</div>
            <p style={{ color: '#ef4444', marginBottom: 16 }}>{error}</p>
            <button className="btn btn-outline btn-sm" onClick={loadItems}>重试</button>
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📭</div>
            <p>{search || channelFilter || yearFilter ? '未找到匹配的样品记录' : '暂无数据，请前往存储系统录入样品信息'}</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input type="checkbox" checked={selectAll} onChange={toggleSelectAll} className="table-checkbox" />
                    </th>
                    <th>货架号</th>
                    <th>移印编号</th>
                    <th>销售</th>
                    <th style={{ width: 80 }}>图片</th>
                    <th>人员</th>
                    <th>创建时间</th>
                    <th>格子号</th>
                    <th>产品货号</th>
                    <th style={{ width: 130 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.map(item => (
                    <tr key={item.id} className={selectedIds.has(item.id) ? 'row-selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="table-checkbox"
                        />
                      </td>
                      <td><strong>{item.shelf_number}</strong></td>
                      <td className="cell-code">{item.stamp_code}</td>
                      <td>
                        <span className={`channel-tag channel-${getChannelColor(item.sales_channel)}`}>
                          {item.sales_channel || '-'}
                        </span>
                      </td>
                      <td>
                        {item.image_url && item.image_url !== 'EMPTY' ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className="sample-image"
                            onClick={() => setExpandedImage(item)}
                            onError={e => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="no-image">📷</div>
                        )}
                      </td>
                      <td>{item.staff_name || '-'}</td>
                      <td className="cell-time">{item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</td>
                      <td>{item.grid_number || '-'}</td>
                      <td className="cell-mono">{item.product_code || '-'}</td>
                      <td>
                        <button className="btn btn-outline btn-xs" onClick={() => setEditModal(item)}>编辑</button>
                        <button className="btn btn-ghost-danger btn-xs" onClick={() => handleDelete(item.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 底部信息栏 */}
            <div className="table-footer">
              <span className="table-count">共 {safeItems.length} 条记录</span>
              {totalPages > 1 && (
                <div className="pagination">
                  <button disabled={page === 1} onClick={() => setPage(1)} title="首页">«« 首页</button>
                  <button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p;
                    if (totalPages <= 7) {
                      p = i + 1;
                    } else if (page <= 4) {
                      p = i + 1;
                    } else if (page >= totalPages - 3) {
                      p = totalPages - 6 + i;
                    } else {
                      p = page - 3 + i;
                    }
                    return <button key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>;
                  })}
                  <button disabled={page === totalPages} onClick={() => setPage(page + 1)}>下一页</button>
                  <button disabled={page === totalPages} onClick={() => setPage(totalPages)} title="尾页">尾页 »»</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>编辑样品信息</h2>
            <div className="modal-form-grid">
              <div className="form-group">
                <label>货架号</label>
                <input type="text" value={editModal.shelf_number || ''} onChange={e => setEditModal({ ...editModal, shelf_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>移印编号</label>
                <input type="text" value={editModal.stamp_code || ''} onChange={e => setEditModal({ ...editModal, stamp_code: e.target.value })} />
              </div>
              <div className="form-group">
                <label>销售</label>
                <input type="text" value={editModal.sales_channel || ''} onChange={e => setEditModal({ ...editModal, sales_channel: e.target.value })} />
              </div>
              <div className="form-group">
                <label>人员</label>
                <input type="text" value={editModal.staff_name || ''} onChange={e => setEditModal({ ...editModal, staff_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>格子号</label>
                <input type="text" value={editModal.grid_number || ''} onChange={e => setEditModal({ ...editModal, grid_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>产品货号</label>
                <input type="text" value={editModal.product_code || ''} onChange={e => setEditModal({ ...editModal, product_code: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>样品图片</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {editModal.image_url && editModal.image_url !== 'EMPTY' && (
                    <img src={editModal.image_url} alt="预览" className="upload-preview-img" style={{ maxWidth: 120, maxHeight: 120 }} />
                  )}
                  <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                    更换图片
                    <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setEditModal(null)}>取消</button>
              <button className="btn btn-primary-glow" onClick={handleEdit}>保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* 图片放大预览弹窗 */}
      {expandedImage && (
        <div className="image-lightbox" onClick={() => setExpandedImage(null)}>
          <button className="image-lightbox-close" onClick={() => setExpandedImage(null)} aria-label="关闭预览">×</button>
          <div className="image-lightbox-content" onClick={e => e.stopPropagation()}>
            <img
              src={expandedImage.image_url}
              alt={expandedImage.stamp_code || '样品图片'}
              className="image-lightbox-img"
              onError={e => { e.currentTarget.alt = '图片加载失败'; }}
            />
            <div className="image-lightbox-info">
              <span className="image-lightbox-code">{expandedImage.stamp_code || '-'}</span>
              <span className="image-lightbox-sep">/</span>
              <span className="image-lightbox-shelf">{expandedImage.shelf_number || '-'}</span>
              {expandedImage.product_code && (
                <>
                  <span className="image-lightbox-sep">·</span>
                  <span className="image-lightbox-product">{expandedImage.product_code}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 渠道颜色映射
function getChannelColor(channel) {
  if (!channel) return 'default';
  const colors = ['blue', 'cyan', 'purple', 'green', 'orange', 'pink', 'teal'];
  let hash = 0;
  for (let i = 0; i < channel.length; i++) { hash = channel.charCodeAt(i) + ((hash << 5) - hash); }
  return colors[Math.abs(hash) % colors.length];
}