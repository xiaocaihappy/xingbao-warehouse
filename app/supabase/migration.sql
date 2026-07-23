-- ============================================================
-- 星堡移印仓储系统 - Supabase RLS 策略 (Row Level Security)
-- 在 Supabase Dashboard -> SQL Editor 中执行此脚本
-- ============================================================

-- 1. storage_items 表 - 样品存储数据
ALTER TABLE public.storage_items ENABLE ROW LEVEL SECURITY;

-- 已登录用户可以读取所有数据
CREATE POLICY "已登录用户可以读取 storage_items"
ON public.storage_items
FOR SELECT
TO authenticated
USING (true);

-- 已登录用户可以插入数据
CREATE POLICY "已登录用户可以插入 storage_items"
ON public.storage_items
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 已登录用户可以更新数据
CREATE POLICY "已登录用户可以更新 storage_items"
ON public.storage_items
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 已登录用户可以删除数据
CREATE POLICY "已登录用户可以删除 storage_items"
ON public.storage_items
FOR DELETE
TO authenticated
USING (true);

-- 2. staff_list 表 - 人员列表
ALTER TABLE public.staff_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "已登录用户可以读取 staff_list"
ON public.staff_list
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "已登录用户可以插入 staff_list"
ON public.staff_list
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "已登录用户可以删除 staff_list"
ON public.staff_list
FOR DELETE
TO authenticated
USING (true);
