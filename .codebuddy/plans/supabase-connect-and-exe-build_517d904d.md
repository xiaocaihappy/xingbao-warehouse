---
name: supabase-connect-and-exe-build
overview: 修复项目配置使其正确连接 Supabase 数据库，不修改数据库内容，并确保可打包为 Windows .exe。
todos:
  - id: fix-package-json
    content: 修复 package.json，补充缺失的 dependencies 和 devDependencies 字段
    status: completed
  - id: verify-env-config
    content: 验证 .env 中 Supabase URL 和 ANON Key 配置完整性，同步更新 .env.example
    status: completed
  - id: verify-supabase-connection
    content: 使用 [mcp:Supabase] 验证数据库连接和 storage_items 表字段与代码一致性
    status: completed
    dependencies:
      - fix-package-json
      - verify-env-config
  - id: install-and-test-dev
    content: 执行 npm install 并验证开发模式启动正常
    status: completed
    dependencies:
      - fix-package-json
  - id: verify-exe-build
    content: 验证 vite build 和 electron-builder 打包流程，确保可生成 .exe
    status: completed
    dependencies:
      - install-and-test-dev
---

## 用户需求

1. **连接 Supabase 数据库**：确保项目能正常连接到已有的 Supabase 实例
2. **不修改数据库**：严格禁止修改 Supabase 数据库的任何内容（不运行 migration、不改表结构、不改数据、不改 RLS 策略）
3. **打包为 .exe**：项目最终能通过 electron-builder 打包为 Windows 可执行安装程序

## 产品概述

星堡移印样品仓储系统是一个基于 Electron 的桌面应用，用于管理移印/丝印/烫金样品的入库、查询、编辑和删除。系统使用 Supabase 作为后端数据库和认证服务，支持实时多人协作数据同步。

## 核心功能

- 用户邮箱注册/登录认证
- 样品录入：货架号、印章编号、销售渠道、人员姓名、网格号、产品编码、样品图片
- 多维度模糊查询：按货架号、印章编号、销售渠道、人员、网格号、产品编码搜索
- 样品编辑与删除
- 图片上传到 Supabase Storage
- Supabase Realtime 实时数据同步

## 技术栈

- 前端框架：React 19 + Vite 8
- 桌面容器：Electron 42
- 后端服务：Supabase BaaS（认证、数据库、存储、实时）
- 语言：JavaScript (JSX)
- 样式：手写 CSS（无框架依赖）
- 打包工具：electron-builder（Windows NSIS）

## 实施方案

### 修复策略

核心问题是 `package.json` 缺失 `dependencies` 和 `devDependencies` 字段，导致项目无法通过 `npm install` 恢复依赖。同时需要验证 Supabase 连接可用。

#### 1. 修复 package.json 依赖声明

根据 `node_modules` 中已存在的实际包和项目导入语句，补充完整的 `dependencies` 和 `devDependencies`：

- **dependencies**：`@supabase/supabase-js`（Supabase 客户端）、`react`、`react-dom`
- **devDependencies**：`@vitejs/plugin-react`、`concurrently`、`cross-env`、`electron`、`electron-builder`、`vite`、`wait-on`

版本号参考 `node_modules` 中实际安装的版本：

- `@supabase/supabase-js`: `^2.108.2`
- `react`: `^19.2.7` / `react-dom`: `^19.2.7`
- `@vitejs/plugin-react`: `^5.0.2`
- `vite`: `^8.0.16`
- `electron`: `^42.4.1`
- `electron-builder`: `^26.15.3`
- `concurrently`: `^9.1.2`
- `cross-env`: `^7.0.3`
- `wait-on`: `^8.0.3`

#### 2. Supabase 连接验证

当前 `.env` 中已配置正确的 Supabase URL 和 ANON Key。`src/supabase.js` 使用 `createClient` 初始化客户端，代码结构完整。连接验证通过以下方式：

- 确保 `.env` 中的 ANON Key 格式正确且未被截断
- 验证 `src/supabase.js` 中 `createClient` 初始化无误
- 不会运行任何 SQL 语句或修改数据库内容

#### 3. Electron 打包验证

`package.json` 中已配置完整的 electron-builder 打包配置：

- `appId`: `com.xingbao.warehouse`
- 目标平台：Windows NSIS 安装包
- 安装选项：可选择安装目录、创建桌面快捷方式
- 构建产物输出到 `dist-electron` 目录

打包流程：`vite build` 构建前端资源 → `electron-builder` 打包为 `.exe`

### 关键约束

- **严格只读数据库**：不执行任何 DDL/DML 语句
- **不修改 RLS 策略**
- **不创建/修改 Storage Bucket**
- **仅修改本地项目文件**：`.env` 配置和 `package.json`

## 目录结构

```
app/
├── package.json              # [MODIFY] 补充 dependencies 和 devDependencies 字段
├── .env                      # [VERIFY] 确认 Supabase URL 和 ANON Key 完整有效
├── .env.example              # [MODIFY] 同步更新模板文件
├── main.js                   # [UNCHANGED] Electron 主进程
├── preload.js                # [UNCHANGED] 预加载脚本
├── vite.config.js            # [UNCHANGED] Vite 构建配置
├── index.html                # [UNCHANGED] HTML 入口
├── supabase-schema.sql       # [UNCHANGED] 仅参考，不执行
└── src/
    ├── main.jsx              # [UNCHANGED] React 挂载入口
    ├── App.jsx               # [UNCHANGED] 根组件
    ├── index.css             # [UNCHANGED] 全局样式
    ├── supabase.js           # [VERIFY] 确认 Supabase 客户端初始化
    └── pages/
        ├── Login.jsx         # [UNCHANGED] 登录页
        ├── Dashboard.jsx     # [UNCHANGED] 仪表盘
        ├── Storage.jsx       # [UNCHANGED] 存储录入
        └── Query.jsx         # [UNCHANGED] 查询编辑
```

## Agent Extensions

### MCP

- **Supabase**
- 目的：列出数据库表结构，验证 `storage_items` 表存在且字段与代码匹配
- 预期结果：确认表结构与 `src/supabase.js` 中的操作字段完全对应，连接正常