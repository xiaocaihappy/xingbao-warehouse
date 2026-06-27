import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

// 璁よ瘉鐩稿叧
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

// 鏁版嵁鎿嶄綔 - 瀵规帴 storage_items 琛?export async function fetchItems(filters = {}) {
  let query = supabase.from(TABLE_NAME).select('*');

  if (filters.search) {
    query = query.or(
      `shelf_number.ilike.%${filters.search}%,stamp_code.ilike.%${filters.search}%,sales_channel.ilike.%${filters.search}%,staff_name.ilike.%${filters.search}%,grid_number.ilike.%${filters.search}%,product_code.ilike.%${filters.search}%`
    );
  }
  if (filters.sales_channel) {
    query = query.eq('sales_channel', filters.sales_channel);
  }
  if (filters.shelf_number) {
    query = query.ilike('shelf_number', `%${filters.shelf_number}%`);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  return { data, error };
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
    console.error('鍥剧墖涓婁紶澶辫触:', error);
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

// 瀹炴椂璁㈤槄
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