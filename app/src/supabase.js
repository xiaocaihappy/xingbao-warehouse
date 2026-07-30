import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 配置缺失时不让 createClient 同步抛错（否则整包加载即崩、ErrorBoundary 接不住）
export const SUPABASE_CONFIG_ERROR =
  !supabaseUrl || !supabaseAnonKey
    ? 'Supabase 配置缺失：VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未注入。打包时请确保存在有效的 .env 文件。'
    : null;

export const supabase = SUPABASE_CONFIG_ERROR
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    reconnectAfterMs: (tries) => {
      if (tries > 3) return 60000;
      return [3000, 8000, 15000][tries - 1] || 60000;
    },
  },
  global: {
    headers: { 'X-Client-Info': 'xingbao-warehouse' },
    fetch: (url, options = {}) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      return fetch(url, {
        ...options,
        signal: controller.signal,
      })
        .then((res) => {
          clearTimeout(timeoutId);
          return res;
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          throw err;
        });
    },
  },
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const TABLE_NAME = 'storage_items';

// 用户认证
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// 数据操作 - 对 storage_items 表
// 分页模式：传入 page（1 基）/pageSize 时，只返回该页数据并返回总数 count。
// 兼容模式：不传 page 时返回全部匹配行（Storage 查重依赖此行为，切勿改为分页）。
export async function fetchItems(filters = {}) {
  const { search, sales_channel, shelf_number, year, page, pageSize } = filters;

  const applyCommon = (q) => {
    if (search) {
      q = q.or(
        `shelf_number.ilike.%${search}%,stamp_code.ilike.%${search}%,sales_channel.ilike.%${search}%,staff_name.ilike.%${search}%,grid_number.ilike.%${search}%,product_code.ilike.%${search}%`
      );
    }
    if (sales_channel) q = q.eq('sales_channel', sales_channel);
    if (shelf_number) q = q.ilike('shelf_number', `%${shelf_number}%`);
    if (year) {
      const next = String(Number(year) + 1);
      q = q.gte('created_at', `${year}-01-01T00:00:00`).lt('created_at', `${next}-01-01T00:00:00`);
    }
    return q;
  };

  // —— 分页模式：服务端 range + 精确总数 ——
  if (typeof page === 'number') {
    const size = pageSize || 12;
    const from = (page - 1) * size;
    const to = from + size - 1;
    let query = supabase
      .from(TABLE_NAME)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    query = applyCommon(query);
    query = query.range(from, to);
    const { data, error, count } = await query;
    return { data: data || [], count: count ?? 0, error };
  }

  // —— 兼容模式：返回全部匹配行 ——
  let query = supabase.from(TABLE_NAME).select('*');
  query = applyCommon(query);
  query = query.order('created_at', { ascending: false });
  const { data, error } = await query;
  return { data, error };
}

// 轻量统计：总数（head count，不下载行）+ 渠道分布（仅取 sales_channel 轻列）
export async function fetchItemStats() {
  const { count, error: countErr } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true });
  if (countErr) return { total: 0, channels: [], error: countErr };

  const { data, error } = await supabase.from(TABLE_NAME).select('sales_channel');
  const channelMap = {};
  (data || []).forEach((it) => {
    const ch = it.sales_channel || '未分类';
    channelMap[ch] = (channelMap[ch] || 0) + 1;
  });
  const channels = Object.entries(channelMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  return { total: count || 0, channels, error: error || null };
}

// 筛选下拉选项：去重渠道 + 年份（仅取轻量列，无图片）
export async function fetchFilterOptions() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('sales_channel, created_at');
  if (error) return { channels: [], years: [], error };
  const channels = [...new Set((data || []).map((i) => i.sales_channel).filter(Boolean))].sort();
  const years = [...new Set((data || []).map((i) => (i.created_at || '').slice(0, 4)).filter(Boolean))]
    .sort()
    .reverse();
  return { channels, years, error: null };
}

export async function insertItem(item) {
  const { data, error } = await supabase.from(TABLE_NAME).insert([item]).select();
  return { data, error };
}

export async function updateItem(id, updates) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  return { data, error };
}

export async function deleteItem(id) {
  const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id);
  return { error };
}

export async function uploadImage(file) {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
  const { data, error } = await supabase.storage
    .from('storage-images')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });
  if (error) {
    console.error('图片上传失败:', error);
    return { data: null, error };
  }

  const { data: urlData } = supabase.storage
    .from('storage-images')
    .getPublicUrl(fileName);
  return { data: urlData.publicUrl, error: null };
}

export async function deleteImage(url) {
  const path = url.split('/').pop();
  if (!path) return { error: null };
  const { error } = await supabase.storage
    .from('storage-images')
    .remove([path]);
  return { error };
}

// 实时订阅
export function subscribeToItems(callback) {
  return supabase
    .channel('storage-items-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      (payload) => callback(payload)
    )
    .subscribe();
}

// ============================================================
// 人员列表（所有用户实时同步）
// ============================================================
const STAFF_TABLE = 'staff_list';

// 获取所有人员（默认 + 自定义，按 id 排序）
export async function fetchStaffList() {
  const { data, error } = await supabase
    .from(STAFF_TABLE)
    .select('*')
    .order('id', { ascending: true });
  return { data: data || [], error };
}

// 添加人员（去重）
export async function addStaffMember(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { data: null, error: { message: '姓名不能为空' } };
  // 先检查是否已存在
  const { data: existing } = await supabase
    .from(STAFF_TABLE)
    .select('id')
    .eq('name', trimmed)
    .maybeSingle();
  if (existing) {
    return { data: existing, error: { message: '该姓名已存在' } };
  }
  const { data, error } = await supabase
    .from(STAFF_TABLE)
    .insert([{ name: trimmed, is_default: false }])
    .select()
    .single();
  return { data, error };
}

// 删除人员
export async function deleteStaffMember(id) {
  const { error } = await supabase
    .from(STAFF_TABLE)
    .delete()
    .eq('id', id);
  return { error };
}

// 初始化默认人员（仅当表为空时）
export async function seedDefaultStaff(defaultNames = []) {
  if (!defaultNames.length) return;
  const { data: existing } = await supabase
    .from(STAFF_TABLE)
    .select('id')
    .limit(1);
  if (existing && existing.length > 0) return; // 已有数据，跳过

  const rows = defaultNames.map(name => ({ name, is_default: true }));
  await supabase.from(STAFF_TABLE).insert(rows);
}

// 实时订阅人员变化
export function subscribeToStaffList(callback) {
  return supabase
    .channel('staff-list-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: STAFF_TABLE },
      (payload) => callback(payload)
    )
    .subscribe();
}

export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  return { data, error };
}

export async function updatePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { data, error };
}
