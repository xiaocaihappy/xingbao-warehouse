-- 给 storage_items 表增加备注列（文本类型，可为空）
-- 在 Supabase 后台 → SQL Editor 中执行本文件即可。
-- 注意：必须先执行此脚本，再安装/使用新版本（1.1.23），
-- 否则保存时会因“列 remarks 不存在”而报错。

ALTER TABLE storage_items
  ADD COLUMN IF NOT EXISTS remarks text;

-- 如需限制长度（可选，当前代码 maxLength=500 仅前端约束）：
-- ALTER TABLE storage_items
--   ADD COLUMN IF NOT EXISTS remarks varchar(500);

COMMENT ON COLUMN storage_items.remarks IS '样品备注信息';
