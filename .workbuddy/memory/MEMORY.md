# 项目长期记忆 - 星堡移印仓储系统

## 工作流惯例
- **每次改完代码必须 git 提交**（用户明确要求）。提交范围：源码改动（如 `app/src/**`、`app/package.json`）。
- 构建产物（`release-build/*.exe`、`dist/`、`*.blockmap`）已被 `.gitignore` 忽略，**不要提交**到仓库。
- 提交信息用中文，说明改了什么、对应版本号。

## 样式约定（重要！）
- 表单相关 class 必须用 **`stg-` 前缀**（如 `stg-card`、`stg-field-input`、`stg-btn`）。这是 v1.1.22 的正确基准。
- ⚠️ 血的教训：v1.1.23 误把 `Storage.jsx` 里所有 `stg-` 前缀 class 删掉，但 CSS 没跟着改名，导致表单样式全丢（SelectField 用的 `.field-group` 无前缀所以没崩）。**以后改 Storage.jsx 千万别动 class 命名**，除非同步改 CSS。
- 用户死命令：**只加功能，不改布局/样式**。任何视觉改动都要先问。

## 构建/打包
- Electron + Vite + electron-builder。正确打包流程（在 `app/` 下，分两步）：
  1. 重建：`NODE_OPTIONS="" npm run build`（dist 先手动 `rm -rf dist` 再 build 更稳）
  2. 打包：`NODE_OPTIONS="" ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ./node_modules/.bin/electron-builder --win`
- **`NODE_OPTIONS=""` 必须直接挂在 node 调用上**（npm / electron-builder 各自前缀），不要包在 `bash -c '...'` 外层——工具的 shell 会单独给 node 注入 shim，外层前缀透传不到 vite 子进程。
- 必须加 `NODE_OPTIONS=""`：本机注入 safe-delete shim，会把 `fs.rm` 改去回收站，导致 vite 清 `dist`、electron-builder 删临时文件报错（fail-closed 直接中断构建）。
- ⚠️ **中断的打包会留锁目录**：`release-build/win-unpacked.tmp.lock`（proper-lockfile 用 mkdir 原子锁，是**目录**不是文件）。下次打包报 "Lock file is already being held" 时，用 `rm -rf release-build/win-unpacked.tmp.lock release-build/win-unpacked` 清掉再打。`rm -f` 删不了目录锁。
- 版本号在 `app/package.json` 的 `version` 字段，每次发布 +1（如 1.1.25）。

## 功能要点（当前代码已实现）
- 存储表单：回车跳下一输入框；全部 6 字段（货架号/格子/货号/移印编号/销售列/仓储人员）填完自动查重，命中相同记录弹审查弹窗（对比输入值 vs 数据库值，可返回修改或确认保存）。
- 重复判定：全字段忽略大小写 + 首尾空格比对。
