# 星堡移印仓储系统 - 项目记忆

## 项目概述
- 星堡移印样品仓储系统，管理移印/丝印/烫金样品
- 技术栈：React 19 + Vite 8 + Electron 42 + Supabase (BaaS)
- 纯 JavaScript (JSX) + 手写 CSS
- Electron 42 (Chromium 134)

## Supabase 连接信息
- URL: `https://kxtsomnzksxqkuhieqxg.supabase.co`
- 代码操作 `storage_items` 表（shelf_number, stamp_code, sales_channel, staff_name, grid_number, product_code, image_url）
- Supabase Storage bucket: `samples`（图片存储）
- 严格约束：不能通过 migration 修改数据库结构/数据

## 关键配置
- `.env` 已配置 Supabase 连接
- Electron 打包使用国内镜像加速：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- 打包命令：`npm run pack` (解压版) / `npm run dist` (NSIS 安装包) / `npm run publish` (发布+自动更新)
- NSIS 安装器：`星堡移印仓储系统 Setup 1.0.0.exe` (~101MB)
- 自动更新：`electron-updater` + generic provider，发布产物包含 `latest.yml` + `.exe.blockmap`

## 项目结构
```
app/
├── main.js          # Electron 主进程（集成 auto-updater + IPC）
├── preload.js       # 预加载脚本（暴露 update API）
├── updater.js       # 自动更新核心模块（检测/下载/安装/定时检查）
├── vite.config.js   # Vite 构建 (base: './')
├── src/
│   ├── supabase.js  # Supabase API 封装（认证、CRUD、存储、实时）
│   ├── App.jsx      # 根组件（认证路由）
│   ├── index.css    # 全局样式（含 update-notifier 样式）
│   ├── components/
│   │   └── UpdateNotifier.jsx  # 更新通知 UI 组件
│   └── pages/
│       ├── Login.jsx     # 登录注册
│       ├── Dashboard.jsx # 仪表盘（集成 UpdateNotifier）
│       ├── Storage.jsx   # 样品录入 + Excel 导入
│       └── Query.jsx     # 查询编辑删除 + CSV/ZIP 导出
```

## 自动更新部署流程
1. 构建 `npm run build` → 打包 `npx electron-builder --win`（不用 ELECTRON_MIRROR，直接 GitHub 源）
2. 发布到 GitHub Releases：`npx electron-builder --win --publish always`（需 GH_TOKEN）
3. GH_TOKEN 必须是 Classic Token（Fine-grained 会 403）
4. Release 页面：https://github.com/xiaocaihappy/xingbao-warehouse/releases
5. 客户端启动后5秒静默检查 `latest.yml`
6. 发现新版本 → 顶部通知栏显示 → 用户可手动下载安装

## GitHub 仓库
- 仓库地址：https://github.com/xiaocaihappy/xingbao-warehouse
- 分支：main
- SSH 密钥已配置，使用 ssh.github.com:443 绕过防火墙
- Classic PAT Token（repo 权限）用于发布 Release

## ⚠️ 版本号规则（严格）
- **每次修改必须升级版本号**，例如 1.1.0 → 1.1.1，否则 autoUpdater 不会推送更新
- 发布前必须：修改 `app/package.json` 的 `version` 字段

## 发布流程
1. 修改 `app/package.json` 版本号
2. 双击 `发布.bat` 一键构建 + 推送 Tag + 打包 + 发布到 GitHub Releases
3. 发布.bat 会自动读取 version 并推送 git tag

## v1.1.1 已发布
- Release: https://github.com/xiaocaihappy/xingbao-warehouse/releases/tag/v1.1.1
- 更新内容：亮青主题下渠道标签文字改为黑色

## 已知问题
- NSIS 打包时需确保无进程占用 `dist-electron` 目录（EPERM 错误）
- PS 环境下 electron-builder 输出可能被 CLIXML 截断，建议用 cmd 运行
- Logo 使用 XBlogo.png (80KB)，electron-builder 自动转为 .ico

## 2026-06-22 修改记录
- Logo 去除椭圆裁剪：移除 `splash.html`、`index.css`（`.sidebar-logo`、`.login-logo`）中的 `border-radius`
- 在线更新分析：当前 publish.url 为 `http://localhost:8080`，指向不存在的本地服务器导致更新失败。需部署到公网服务器（GitHub Releases 推荐）并修改 publish.url 才能正常工作。文件（latest.yml + exe + blockmap）已在 dist-electron/ 中就绪。
