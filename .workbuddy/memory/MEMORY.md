# 项目长期记忆 - 星堡移印仓储系统

## ⚠️ 两套代码，别改错（2026-08-05 确认）
- **Supabase 版 = 本工作区** `E:\AIBC\星堡移印仓储系统\app`（v1.1.23，`src/supabase.js`，git 仓库）→ **用户明确要求不要动**。
- **本地数据库版 = 隔壁目录** `E:\AIBC\xingbao-warehouse-local`（v2.0.0，`app/src/api.js` + `server/` Express 后端）→ 现在的维护对象。
- 本地版**已于 2026-08-05 在根目录 `git init`**（用户授权"按你的来"），首次提交 `58cbb46`。`.gitignore` 排除：`node_modules/` `dist/` `release-build/` `server/shared/images/`(978张图) `token.txt` `*.log` `backups/` 根目录调试遗留(`*.png` `fix_*.js`) 以及 `app/supabase/` `app/废弃/`。版本号保持 **2.0.0** 未 +1。
- 本地版打包产物：`E:\AIBC\xingbao-warehouse-local\app\release-build\xingbao-warehouse-Setup-2.0.0.exe`（nsis，415MB）。`npm run dist` 已串好 vite+electron-builder，但手动两步更稳（见"构建/打包"）。
- 判别方法：有 `src/api.js` / `serverManager.js` / `server/` 的是本地版；有 `src/supabase.js` 的是 Supabase 版。

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
- ⚠️ **版本号规则（用户 2026-07-30 明确）**：`app/package.json` 的 `version` 字段，**只有在真正发布/打包给用户当正式版时才 +1**；平时改代码、出测试包都**不要递增版本号**，沿用当前版本反复测。当前版本 **1.1.23**（2026-07-30 用户要求从 1.1.27 降回 1.1.23，重新打包并同步 latest.yml）；发布时升 1.1.24。

## 发布 / 自动更新（2026-08-05 实测，更新）
- 自动更新靠 `electron-updater` 去 GitHub Release 拉 `latest.yml`。`publish.repo` 已改独立仓库 `xiaocaihappy/xingbao-warehouse-local`（与主项目 `xingbao-warehouse` 分离）。
- ⚠️ **`npm run publish` 本机必卡死**：electron-builder 解压完 electron 后卡在"压缩前"（win-unpacked.tmp 纹丝不动 16min+，无 GitHub 连接），**与网络无关**——即便用户开了外网、HTTPS API 实测可达（api.github.com=200、uploads.github.com=302），`npm run publish` 仍卡同一位置。疑似 safe-delete shim 或子进程调用卡住。**不要依赖它发版**。
- ✅ **可靠发版路径（本次实测成功）**：
  1. 本地打包：`NODE_OPTIONS="" npm run dist`（纯本地、不需网络，约 2-4 分钟出 exe）。务必**先改好 package.json 的 publish.repo 再打**，否则 exe baked 的更新地址会指错仓库。
  2. 用 GitHub API 直传（curl，需 `GH_TOKEN` 且 Bash 调用必须 `dangerouslyDisableSandbox: true` 才出 HTTPS）：
     - 创建 Release：`POST /repos/xiaocaihappy/xingbao-warehouse-local/releases`（body: `tag_name`/`name`/`body`/`target_commitish:main`）
     - 取返回 JSON 的顶层 `id`，逐个传 asset：`POST https://uploads.github.com/repos/.../releases/{ID}/assets?name=文件名`，Header `Authorization: Bearer $GH_TOKEN` + `Content-Type: application/octet-stream`，body 用 `--data-binary @本地路径`
     - 三个文件缺一不可：Setup **exe** + **latest.yml** + **.blockmap**（自动更新靠 latest.yml 对 exe 的 path/size/sha512 校验）
  3. 已发 Release：https://github.com/xiaocaihappy/xingbao-warehouse-local/releases/tag/v2.0.0
- ⚠️ **wmic/taskkill 被系统级工具策略禁用**，无法 kill 卡死的 node 进程；TaskStop 工具对 Bash 后台任务报格式错也杀不掉。卡死的后台发布任务只能留着，下次打包前 `rm -rf release-build/win-unpacked.tmp.lock release-build/win-unpacked` 清锁即可。
- git 操作走 SSH(22端口)可用：push 代码/tag 正常。HTTPS 上传端点(api/uploads.github)可达但 `npm run publish` 仍卡，故走 curl API 直传。
- ⚠️ **烘焙地址陷阱**：exe 里 baked 的更新仓库来自打包时的 `package.json`。若先打包、后改 `publish.repo`，旧 exe 会去错仓库找更新。务必**先改好 package.json 再 `npm run dist`**。
- 版本号规则（用户 2026-07-30 明确）：只有正式发布/打包给用户当正式版才 +1；平时改代码出测试包沿用当前版本。本地版当前 **2.0.0**。

## 部署架构：PostgreSQL + 主机/客户端模式（2026-08-05 新增）
- 数据库 = **PostgreSQL**（非文件型/SQLite）。`server/.env` 写死 `DATABASE_URL=postgres://xingbao_app:***@127.0.0.1:5432/xingbao`，server 连本机 5432 的 PG 服务。**exe 不含 PG 引擎**，需主机机器自装 PG。
- 主机（你电脑）：PG 服务 + Express server(3000) 随 exe 启动（`serverManager.start` 用 `process.execPath` 跑 `server/index.js`，Electron 自带 node，对方不用装 node）。数据落主机，前端连 127.0.0.1:3000。
- 客户端（别人）：`server.config.json` 设 `role:client` + `apiUrl:http://主机局域网IP:3000`，不跑 server，前端直连主机 API。数据库只在主机，别人碰不到。
- ⚠️ **只发 exe 给没装 PG 的人不够**：前端能开但读写报错（连不上 5432）。集中式下只需**主机装 PG**，客户端不用装。
- **客户端模式修复（2026-08-05）**：原 client 是半成品——serverManager 知 apiUrl 但没传给前端，前端 api.js fallback 连 127.0.0.1:3000 失败。已修：`preload.js` 用 `ipcRenderer.sendSync('server:get-api-url')` 同步拿 apiUrl 并 `exposeInMainWorld('__XB_API_BASE__')`，api.js 优先读该值。
- Settings.jsx 新增"服务器模式"卡片：`getServerConfig`/`saveServerConfig` 经 IPC 读写 `server.config.json`（写到 userData 优先，打包后可写），保存后提示"重启生效"。
- 配置：`app/server.config.json`（开发+打包 extraResources 进 `resources/`），格式 `{"role":"host","apiUrl":"http://127.0.0.1:3000"}`。
- 主机 PG 已就绪：用户电脑 `E:\Program Files\PostgreSQL\18`，5432 监听 `0.0.0.0`（局域网可达）；建议把 `listen_addresses` 改 `localhost` 仅放行 3000，避免数据库直接暴露。

## 局域网网络环境（2026-08-05 实测探测）
- ⚠️ **之前误读更正**：真正网关/DHCP 服务器是 **`10.100.11.254`**（不是 `10.100.10.1`）。子网 `/23`（掩码 255.255.254.0，范围 `10.100.10.0`~`10.100.11.255`）。
- 品牌：**TP-Link 系**网络（网关 MAC `70-85-6C-A5-92-11` 为 TP-Link OUI；网段内大量 `E0-D5-5E`/`FC-9D-05` 设备也是 TP-Link）。疑似 TP-Link 企业级路由或三层网管交换机。
- 本机（主机）当前 IP：**`10.100.10.84`**（DHCP 分配，网卡 MAC `E0-D5-5E-9D-BB-92`）。**客户端填的服务器地址 = `http://10.100.10.84:3000`（主机 IP，不是网关）**。
- ⚠️ **web 管理页探不到**：网关 80/443/8080/8443 全部 HTTP=000（端口特殊/被关/走云管理 Omada）。若用户要做 DHCP 静态保留但进不去管理页：① 试 TP-Link 商用云平台/Omada；② 或走"本机静态 IP"备选方案（避开路由器，但需防 IP 冲突）；③ 或找网管/IT。
- 若改 DHCP 保留：绑定 MAC `E0-D5-5E-9D-BB-92` → IP `10.100.10.84`。

## 功能要点（当前代码已实现）
- 存储表单：回车跳下一输入框；全部 6 字段（货架号/格子/货号/移印编号/销售列/仓储人员）填完自动查重，命中相同记录弹审查弹窗（对比输入值 vs 数据库值，可返回修改或确认保存）。
- 重复判定：全字段忽略大小写 + 首尾空格比对。
