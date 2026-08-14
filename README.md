# 星堡移印仓储系统

移印签板样品仓储管理系统——基于 **Electron + React + Supabase** 的桌面应用，用于管理移印样品的货架、格子、货号、移印编号、销售列、仓储人员及样品图片。

> 当前版本：v1.1.23（功能含：游客只读模式、备注列、Excel 模板导入含图片、图片裁剪旋转、查询系统服务端分页/缓存秒开/实时增量、自动更新）。

## ✨ 功能特性

- **样品录入**：货架号、格子、货号、移印编号、销售列、仓储人员、备注、样品图片
- **图片处理**：拖拽上传、裁剪（自由 / 正方形）、旋转
- **查重**：录入时自动比对全字段，命中相似记录弹出审查对比弹窗
- **查询系统**：服务端分页 + 缓存秒开 + 图片懒加载 + 实时增量更新；支持筛选、搜索、翻页、导出 Excel（含图片）
- **Excel 导入**：按模板列名映射导入，并同步内嵌图片到数据库
- **人员管理**：仓储人员增删，所有用户实时同步
- **游客模式**：免登录只读浏览，禁止任何写入操作
- **自动更新**：基于 `electron-updater` 的 GitHub Release 自动更新

## 🧰 技术栈

- Electron 42 + Vite 8
- React 19
- Supabase（PostgreSQL + 对象存储 + 实时订阅）
- exceljs / jszip / xlsx

## 📋 环境要求

- Node.js 20+
- 一个 Supabase 项目（获取 Project URL 与 anon key）
- Windows（安装包为 NSIS，x64）

## 🚀 本地开发

```bash
# 1. 克隆
git clone <your-repo-url>
cd xingbao-warehouse/app

# 2. 安装依赖
npm install

# 3. 配置环境变量（复制样例并填入你的 Supabase 配置）
cp .env.example .env
# 编辑 app/.env：
#   VITE_SUPABASE_URL=https://xxxx.supabase.co
#   VITE_SUPABASE_ANON_KEY=eyJ...

# 4. 初始化数据库（在 Supabase SQL Editor 中依次执行）
#   app/supabase-schema.sql         —— 主表结构
#   app/sql/create_staff_list.sql   —— 人员表 + 默认人员（人员管理 / 游客模式必需）
#   app/sql/add_remarks_column.sql  —— 备注列（存储 / 查询备注必需）

# 5. 启动开发模式
npm run dev
```

## 📦 构建安装包

```bash
cd app
npm run dist
# 产物：app/release-build/星堡移印仓储系统-Setup-<version>.exe
```

构建需要可用的 `.env`（含 Supabase 配置）。CI 中由 GitHub Secrets 注入。

## 🔁 自动发布（GitHub Actions）

仓库已内置 `.github/workflows/release.yml`，打 tag 即可自动构建并发布 Release：

1. 在仓库 **Settings → Secrets and variables → Actions** 配置两个 Secret：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. 提升版本号（`app/package.json` 的 `version`）。
3. 打 tag 并推送：
   ```bash
   git tag v1.1.24
   git push origin v1.1.24
   ```
4. GitHub Actions 自动构建安装包并发布到 Releases（含 `latest.yml` 供自动更新）。

> **手动发布**亦可：本地 `npm run dist` 后，在 GitHub 创建 Release，上传 `Setup.exe` + `latest.yml` + `.blockmap` 三个文件。

## 📁 目录结构

```
xingbao-warehouse/
├── .github/workflows/release.yml   # 自动构建发布
├── app/                            # Electron 主程序
│   ├── src/                        # 前端（React 页面与组件）
│   ├── sql/                        # 数据库初始化 SQL
│   ├── supabase-schema.sql         # 主表结构
│   ├── main.js / preload.js        # 主进程
│   └── package.json
├── scripts/                        # 构建 / 发布辅助脚本
└── README.md
```

## ⚠️ 重要提示

- **首次部署必须在 Supabase 执行 3 个 SQL 文件**（见上文「本地开发」第 4 步），否则人员管理、备注功能会报错。
- 游客模式下只能查看数据，不能录入 / 编辑 / 删除 / 导入。
- 自动更新依赖 GitHub Release 的 `latest.yml`，发布时务必同时上传 `.blockmap` 文件。

## 📄 许可证

ISC
