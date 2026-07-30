import { useState, useEffect, useRef } from 'react';
import {
  fetchItems,
  updateItem,
  deleteItem,
  subscribeToItems,
  fetchStaffList,
  subscribeToStaffList,
  seedDefaultStaff,
  fetchFilterOptions,
} from '../supabase';
import {
  getCachedPage,
  setCachedPage,
  getCachedOptions,
  setCachedOptions,
  matchesFilters,
} from '../utils/queryCache';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import ImageEditor from '../components/ImageEditor';
import { useImageUploader } from '../utils/useImageUploader';
import { compressImage, urlToBlob } from '../utils/imageUtils';

const PAGE_SIZE = 12;

export default function Query({ onStatsChange }) {
  const [items, setItems] = useState([]); // 当前页数据（最多 PAGE_SIZE 行）
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [editorFile, setEditorFile] = useState(null);
  const [editDragOver, setEditDragOver] = useState(false);
  const uploader = useImageUploader(showToast);
  const [toast, setToast] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [years, setYears] = useState([]);

  // 用 ref 保存最新状态，供实时增量更新读取（避免闭包过期）
  const itemsRef = useRef(items); itemsRef.current = items;
  const totalCountRef = useRef(totalCount); totalCountRef.current = totalCount;
  const pageRef = useRef(page); pageRef.current = page;
  const filtersRef = useRef({}); filtersRef.current = { search, sales_channel: channelFilter, year: yearFilter };

  function currentFilters() {
    return { search, sales_channel: channelFilter, year: yearFilter };
  }
  function buildFilters() {
    const f = {};
    if (search) f.search = search;
    if (channelFilter) f.sales_channel = channelFilter;
    if (yearFilter) f.year = yearFilter;
    return f;
  }

  // 缩略图：列表图请求小尺寸（若 Supabase 未开启图片变换则该参数被忽略，退化为原图 + 懒加载）
  function thumbUrl(url) {
    if (!url || url === 'EMPTY') return url;
    return url.includes('?')
      ? `${url}&width=240&height=240&resize=cover`
      : `${url}?width=240&height=240&resize=cover`;
  }

  // 加载人员列表（与存储系统同步）
  const DEFAULT_STAFF_NAMES = ['陈育婷', '蔡丹媛', '蔡中卫', '林沐锟', '丁小梅', '林晓媛'];
  useEffect(() => {
    let cancelled = false;
    async function loadStaff() {
      try {
        await seedDefaultStaff(DEFAULT_STAFF_NAMES);
        const { data } = await fetchStaffList();
        if (data && data.length > 0 && !cancelled) {
          setStaffList(data);
          localStorage.setItem('xingbao_staff_fallback', JSON.stringify(data.map((s) => s.name)));
        } else if (!cancelled) {
          const fallback = localStorage.getItem('xingbao_staff_fallback');
          const names = fallback ? JSON.parse(fallback) : DEFAULT_STAFF_NAMES;
          setStaffList(names.map((n, i) => ({ id: 'local-' + i, name: n })));
        }
      } catch {
        if (!cancelled) {
          const fallback = localStorage.getItem('xingbao_staff_fallback');
          const names = fallback ? JSON.parse(fallback) : DEFAULT_STAFF_NAMES;
          setStaffList(names.map((n, i) => ({ id: 'local-' + i, name: n })));
        }
      }
      if (!cancelled) setStaffLoading(false);
    }
    loadStaff();
    const sub = subscribeToStaffList(async () => {
      const { data } = await fetchStaffList();
      if (data && data.length > 0 && !cancelled) {
        setStaffList(data);
        localStorage.setItem('xingbao_staff_fallback', JSON.stringify(data.map((s) => s.name)));
      }
    });
    return () => { cancelled = true; sub?.unsubscribe?.(); };
  }, []);

  // 筛选下拉选项（渠道/年份）：缓存优先，后台刷新
  useEffect(() => { refreshFilterOptions(); }, []);
  async function refreshFilterOptions() {
    const cached = getCachedOptions();
    if (cached) { setChannels(cached.channels); setYears(cached.years); }
    try {
      const { channels: ch, years: yr } = await fetchFilterOptions();
      setChannels(ch); setYears(yr); setCachedOptions(ch, yr);
    } catch { /* 忽略，保留上次结果 */ }
  }

  // 缓存优先加载当前页：有缓存先秒出，后台再静默刷新
  async function loadItems(f, p) {
    const filters = f || currentFilters();
    const pg = typeof p === 'number' ? p : page;
    const cached = getCachedPage(filters, pg);
    if (cached) {
      setItems(cached.rows);
      setTotalCount(cached.count);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const { data, count, error: fetchError } = await fetchItems({ ...filters, page: pg, pageSize: PAGE_SIZE });
      if (fetchError) {
        if (!cached) { setError(fetchError.message || '数据加载失败'); setItems([]); }
      } else {
        setItems(data);
        setTotalCount(count ?? 0);
        setCachedPage(filters, pg, data, count ?? 0);
      }
    } catch (e) {
      if (!cached) { setError(e.message || '加载异常'); setItems([]); }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // 筛选变化 → 回第一页并加载
  useEffect(() => {
    loadItems({ search, sales_channel: channelFilter, year: yearFilter }, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, yearFilter, channelFilter]);

  // 翻页 → 加载对应页
  useEffect(() => {
    loadItems({ search, sales_channel: channelFilter, year: yearFilter }, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // 实时订阅：增量更新当前页（不再全表重拉）
  useEffect(() => {
    let sub = null;
    try {
      sub = subscribeToItems((payload) => applyRealtime(payload));
    } catch (e) { console.error('实时订阅初始化失败:', e); }
    return () => { sub?.unsubscribe?.(); };
  }, []);

  function applyRealtime(payload) {
    const { eventType, new: newRow, old: oldRow } = payload;
    const row = newRow || oldRow;
    if (!row) return;
    const f = filtersRef.current;
    const cur = itemsRef.current;
    const before = matchesFilters(oldRow, f);
    const after = matchesFilters(newRow, f);
    let next = [...cur];
    let delta = 0;
    if (eventType === 'DELETE') {
      next = next.filter((r) => r.id !== row.id);
      delta = -1;
    } else if (eventType === 'INSERT') {
      if (after) {
        if (!next.find((r) => r.id === row.id)) next = [row, ...next];
        delta = 1;
      } else {
        next = next.filter((r) => r.id !== row.id);
      }
    } else if (eventType === 'UPDATE') {
      if (after) {
        const idx = next.findIndex((r) => r.id === row.id);
        if (idx >= 0) next[idx] = row;
        else next = [row, ...next];
      } else {
        next = next.filter((r) => r.id !== row.id);
      }
      delta = (after ? 1 : 0) - (before ? 1 : 0);
    }
    next = next.slice(0, PAGE_SIZE);
    const newCount = (totalCountRef.current || 0) + delta;
    setItems(next);
    setTotalCount(newCount);
    setCachedPage(f, pageRef.current, next, newCount);
    refreshFilterOptions();
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
    else { setSelectedIds(new Set(safeItems.map((i) => i.id))); setSelectAll(true); }
  }

  // 删除
  async function handleDelete(id) {
    if (!confirm('确定删除该记录？此操作不可撤销。')) return;
    const { error: err } = await deleteItem(id);
    if (!err) { showToast('已删除', 'success'); loadItems(filtersRef.current, pageRef.current); onStatsChange?.(); }
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
    loadItems(filtersRef.current, pageRef.current);
    onStatsChange?.();
  }

  // 编辑
  async function handleEdit() {
    const { id, ...updates } = editModal;
    // 若有图片正在后台上传，先等待完成，避免存到不完整的图片
    const url = await uploader.awaitPending();
    updates.image_url = url || editModal.image_url;
    const { error: err } = await updateItem(id, updates);
    if (!err) { showToast('更新成功', 'success'); closeEditModal(); loadItems(filtersRef.current, pageRef.current); onStatsChange?.(); }
    else { showToast('更新失败: ' + err.message, 'error'); }
  }

  // 选/拖图片 → 压缩 → 打开编辑器（裁剪/旋转）
  function openEditorWithFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) { showToast('请选择图片文件', 'error'); return; }
    if (file.size > 15 * 1024 * 1024) { showToast('图片大小不能超过 15MB', 'error'); return; }
    compressImage(file).then((blob) => setEditorFile(blob)).catch(() => showToast('图片读取失败', 'error'));
  }
  function handleImageChange(e) {
    openEditorWithFile(e.target.files?.[0]);
    e.target.value = '';
  }
  function handleEditDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setEditDragOver(false);
    openEditorWithFile(e.dataTransfer?.files?.[0]);
  }
  function handleEditDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setEditDragOver(true);
  }
  function handleEditDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setEditDragOver(false);
  }
  // 编辑当前已有图片：下载为 Blob 后打开编辑器
  async function openExistingImageEditor() {
    const url = uploader.localPreview || editModal?.image_url;
    if (!url || url === 'EMPTY') return;
    try {
      const blob = await urlToBlob(url);
      setEditorFile(blob);
    } catch {
      showToast('无法加载当前图片进行编辑，请尝试更换图片', 'error');
    }
  }
  function openEditModal(item) {
    uploader.clear();
    setEditModal(item);
  }
  function closeEditModal() {
    uploader.clear();
    setEditModal(null);
  }
  // 编辑器确认：拿到裁剪+旋转后的 Blob → 后台异步上传
  function handleEditorApply(blob) {
    setEditorFile(null);
    uploader.startUpload(blob);
  }

  // 导出全部数据（Excel .xlsx 含嵌入图片，通过主进程生成）——按需全量拉取，不依赖当前页缓存
  async function exportCSV() {
    const { data } = await fetchItems(buildFilters());
    const all = Array.isArray(data) ? data : [];
    if (all.length === 0) { showToast('无数据可导出', 'error'); return; }
    const dateStr = new Date().toISOString().slice(0, 10);

    const items = all.map((i) => ({
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

    const withImagesCount = items.filter((i) => i.image_url && i.image_url !== 'EMPTY').length;
    showToast(`正在生成 Excel${withImagesCount > 0 ? `（含 ${withImagesCount} 张图片）` : ''}...`, 'success');

    try {
      const result = await window.electronAPI.exportExcel(items);
      if (!result.success) {
        showToast('Excel 生成失败: ' + (result.error || '未知错误'), 'error');
        return;
      }

      const blob = new Blob([result.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `星堡移印样品_${dateStr}.xlsx`;
      link.click();

      showToast(`已导出 ${all.length} 条数据（含图片的 .xlsx）`, 'success');
    } catch (e) {
      showToast('导出失败: ' + (e.message || '未知错误'), 'error');
    }
  }

  async function exportImages() {
    const { data } = await fetchItems(buildFilters());
    const all = Array.isArray(data) ? data : [];
    const withImages = all.filter((i) => i.image_url && i.image_url !== 'EMPTY');
    if (withImages.length === 0) { showToast('没有可导出的图片', 'error'); return; }
    const html = `<html><body style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px;background:#0f131a;">
      ${withImages.map((i) => `<div style="text-align:center;color:#fff;font-size:12px;">
        <img src="${i.image_url}" style="width:100%;border-radius:8px;" onerror="this.style.display='none'" />
        <p>${i.stamp_code} / ${i.shelf_number}</p></div>`).join('')}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `星堡图片预览_${new Date().toISOString().slice(0, 10)}.html`;
    link.click();
    showToast(`已导出 ${withImages.length} 张图片预览`, 'success');
  }

  async function exportSelected() {
    if (selectedIds.size === 0) { showToast('请先选择记录', 'error'); return; }
    const { data } = await fetchItems(buildFilters());
    const all = Array.isArray(data) ? data : [];
    const selected = all.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) { showToast('所选记录不在当前筛选范围内', 'error'); return; }
    const headers = ['货架号', '移印编号', '销售', '人员', '格子号', '产品货号'];
    const rows = selected.map((i) => [i.shelf_number, i.stamp_code, i.sales_channel, i.staff_name, i.grid_number, i.product_code]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
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
  const pagedItems = safeItems;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary-glow" onClick={() => loadItems(currentFilters(), 1)}>查询</button>
        </div>
        <div className="filter-row">
          <select className="filter-select" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} onMouseDown={(e) => e.stopPropagation()}>
            <option value="">全部渠道</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filter-select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} onMouseDown={(e) => e.stopPropagation()}>
            <option value="">全部年份</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
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
            <button className="btn btn-outline btn-sm" onClick={() => loadItems(currentFilters(), page)}>重试</button>
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
                    <th>格子号</th>
                    <th>产品货号</th>
                    <th>移印编号</th>
                    <th style={{ width: 80 }}>图片</th>
                    <th>销售</th>
                    <th>人员</th>
                    <th>创建时间</th>
                    <th style={{ width: 130 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.map((item) => (
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
                      <td>{item.grid_number || '-'}</td>
                      <td className="cell-mono">{item.product_code || '-'}</td>
                      <td className="cell-code">{item.stamp_code}</td>
                      <td>
                        {item.image_url && item.image_url !== 'EMPTY' ? (
                          <img
                            src={thumbUrl(item.image_url)}
                            alt=""
                            className="sample-image"
                            loading="lazy"
                            decoding="async"
                            onClick={() => setExpandedImage(item)}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="no-image">📷</div>
                        )}
                      </td>
                      <td>
                        <span className={`channel-tag channel-${getChannelColor(item.sales_channel)}`}>
                          {item.sales_channel || '-'}
                        </span>
                      </td>
                      <td>{item.staff_name || '-'}</td>
                      <td className="cell-time">{item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</td>
                      <td>
                        <button className="btn btn-outline btn-xs" onClick={() => openEditModal(item)}>编辑</button>
                        <button className="btn btn-ghost-danger btn-xs" onClick={() => handleDelete(item.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 底部信息栏 */}
            <div className="table-footer">
              <span className="table-count">
                共 {totalCount} 条记录
                {refreshing && <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>· 刷新中…</span>}
              </span>
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
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>编辑样品信息</h2>
            <div className="modal-form-grid">
              <div className="form-group">
                <label>货架号</label>
                <input type="text" value={editModal.shelf_number || ''} onChange={(e) => setEditModal({ ...editModal, shelf_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>移印编号</label>
                <input type="text" value={editModal.stamp_code || ''} onChange={(e) => setEditModal({ ...editModal, stamp_code: e.target.value })} />
              </div>
              <div className="form-group">
                <label>销售</label>
                <input type="text" value={editModal.sales_channel || ''} onChange={(e) => setEditModal({ ...editModal, sales_channel: e.target.value })} />
              </div>
              <div className="form-group">
                <label>人员</label>
                <select
                  value={editModal.staff_name || ''}
                  onChange={(e) => setEditModal({ ...editModal, staff_name: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={staffLoading}
                >
                  <option value="">{staffLoading ? '加载中...' : '请选择人员'}</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>格子号</label>
                <input type="text" value={editModal.grid_number || ''} onChange={(e) => setEditModal({ ...editModal, grid_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>产品货号</label>
                <input type="text" value={editModal.product_code || ''} onChange={(e) => setEditModal({ ...editModal, product_code: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>样品图片</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    borderRadius: 8,
                    boxShadow: editDragOver ? 'inset 0 0 0 2px #00e5c0' : 'none',
                    transition: 'box-shadow 0.15s ease',
                  }}
                  onDrop={handleEditDrop}
                  onDragOver={handleEditDragOver}
                  onDragLeave={handleEditDragLeave}
                  title="可拖拽图片到此处上传或替换"
                >
                  {(editModal.image_url && editModal.image_url !== 'EMPTY') || uploader.localPreview ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={uploader.localPreview || editModal.image_url}
                        alt="预览"
                        className="upload-preview-img"
                        style={{ maxWidth: 120, maxHeight: 120, cursor: 'pointer' }}
                        onClick={openExistingImageEditor}
                        title="点击编辑图片（裁切/旋转）"
                      />
                      {uploader.uploading && <div className="stg-upload-loading-badge">⏳ 上传中</div>}
                      <button
                        type="button"
                        onClick={() => { setEditModal({ ...editModal, image_url: '' }); uploader.clear(); }}
                        className="img-delete-btn"
                        title="删除图片"
                      >×</button>
                    </div>
                  ) : null}
                  <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                    {uploader.uploading ? '⏳ 上传中...' : (editModal.image_url && editModal.image_url !== 'EMPTY' ? '更换图片' : '添加图片')}
                    <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                  </label>
                  {(editModal.image_url && editModal.image_url !== 'EMPTY') && !uploader.localPreview && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={openExistingImageEditor}>
                      编辑图片
                    </button>
                  )}
                  {uploader.uploading && <span className="stg-upload-hint">图片后台上传中，保存时会自动等待完成</span>}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={closeEditModal}>取消</button>
              <button className="btn btn-primary-glow" onClick={handleEdit}>保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* 图片编辑弹窗（裁剪 / 旋转） */}
      {editorFile && (
        <ImageEditor
          file={editorFile}
          onApply={handleEditorApply}
          onCancel={() => setEditorFile(null)}
        />
      )}

      {/* 图片放大预览弹窗（用原图，保证清晰度） */}
      {expandedImage && (
        <div className="image-lightbox" key={expandedImage?.id} onClick={() => setExpandedImage(null)}>
          <button className="image-lightbox-close" onClick={() => setExpandedImage(null)} aria-label="关闭预览">×</button>
          <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={expandedImage.image_url}
              alt={expandedImage.stamp_code || '样品图片'}
              className="image-lightbox-img"
              onError={(e) => { e.currentTarget.alt = '图片加载失败'; }}
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
