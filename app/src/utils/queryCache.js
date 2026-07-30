// 查询页内存缓存：页面数据 + 筛选选项，避免每次打开都全表重拉。
// 纯内存，不落盘，不引入新依赖。Electron 单进程内跨次打开查询页共享。

const pageCache = new Map(); // key: signature -> { rows, count, ts }
let optionsCache = null; // { channels, years, ts }

function signature(filters, page) {
  const f = filters || {};
  return `${f.search || ''}|${f.sales_channel || ''}|${f.year || ''}|p${page ?? 1}`;
}

export function getCachedPage(filters, page) {
  return pageCache.get(signature(filters, page)) || null;
}

export function setCachedPage(filters, page, rows, count) {
  pageCache.set(signature(filters, page), { rows, count, ts: Date.now() });
}

// 失效某一页（实时变更后调用，下次打开该页会重新拉取）
export function invalidatePage(filters, page) {
  pageCache.delete(signature(filters, page));
}

// 清空全部页缓存（结构变动或手动刷新时）
export function clearPageCache() {
  pageCache.clear();
}

export function getCachedOptions() {
  return optionsCache;
}

export function setCachedOptions(channels, years) {
  optionsCache = { channels, years, ts: Date.now() };
}

// 单行是否匹配当前筛选条件（实时增量更新用）
export function matchesFilters(row, filters) {
  if (!row) return false;
  const f = filters || {};
  if (f.search) {
    const s = f.search.toLowerCase();
    const hay = [
      row.shelf_number,
      row.stamp_code,
      row.sales_channel,
      row.staff_name,
      row.grid_number,
      row.product_code,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(s)) return false;
  }
  if (f.sales_channel && row.sales_channel !== f.sales_channel) return false;
  if (f.year && !(row.created_at || '').startsWith(String(f.year))) return false;
  return true;
}
