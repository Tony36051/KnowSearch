# AGENTS.md

本文件为 AI 编码助手提供项目上下文，帮助快速理解代码库。

## 项目概述

KnowSearch 是一个 Chrome 浏览器扩展（Manifest V3），自动捕获浏览过的页面全文内容，支持关键词搜索和语义搜索来查找历史浏览记录。界面语言为中文。

## 开发命令

所有命令在 `crx/` 目录下执行：

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（热重载）
pnpm build            # 生产构建 → .output/chrome-mv3/
pnpm compile          # 仅 TypeScript 类型检查（vue-tsc --noEmit）
pnpm zip              # 打包为 .zip
```

未配置 linter/formatter，`pnpm compile` 是唯一的代码质量检查。

## 架构

基于 **WXT**（Web 扩展框架）+ **Vue 3** + **TypeScript** 构建。WXT 自动从 `crx/entrypoints/` 发现入口点。

### 三个扩展入口

- **Background**（`entrypoints/background.ts`）— Service Worker，中央消息处理器。接收捕获的页面、存入 IndexedDB、构建搜索索引、处理搜索请求。
- **Content Script**（`entrypoints/content.ts`）— 在所有 HTTP/HTTPS 页面运行。通过 MutationObserver + visibilitychange + popstate 检测页面变化（包括 SPA 导航）。使用 Readability 提取内容，计算 SHA-256 哈希，向 background 发送 `capturePage` 消息。
- **Popup**（`entrypoints/popup/`）— Vue 3 单页应用，提供关键词/语义搜索界面和设置面板。

### 核心库（`crx/lib/`）

| 模块 | 职责 |
|---|---|
| `db.ts` | IndexedDB 数据模式（3 个 store：`pages`、`search-terms`、`settings`），使用 `idb` 库 |
| `messaging.ts` | 类型化的 Chrome 消息封装，处理 MV3 Service Worker 异步模式和错误传播（`__knowsearch_error__` 标记） |
| `search.ts` | 自定义倒排索引：英文分词 + CJK 二元组，AND/OR 逻辑，相关度评分（标题匹配、词频、时效性、访问次数） |
| `semantic-client.ts` | 可选的本地 Python 语义搜索服务（localhost:8199）的 HTTP 客户端，不可用时回退到关键词搜索 |
| `storage-manager.ts` | 存储限制：最多 1 万条记录、每条文本 5 万字符上限、90 天保留期、80% 配额阈值触发 20% 删除 |
| `text-extractor.ts` | 通过 `@mozilla/readability` 提取内容，失败时回退到 `body.innerText`；提取 favicon；SHA-256 内容哈希 |

### 数据流

1. Content script 检测到页面变化 → 提取文本 + 哈希 → 向 background 发送 `capturePage`
2. Background 按 contentHash 去重 → 存入 IndexedDB → 构建倒排索引
3. Popup 发送 `searchPages` → background 分发到 `keywordSearch()` 或 `semanticSearch()` → 返回结果

### Vue 层

- **组件**（`crx/components/`）：SearchInput、SearchResultList、SearchResultItem、SettingsPanel
- **组合式函数**（`crx/composables/`）：`useSearch`（防抖查询 + 消息分发）、`useSettings`（通过 background 消息加载/保存设置）

## 关键约定

- 路径别名：`@/*` 映射到 `crx/*`（tsconfig.json 配置）
- Popup/Content 与 Background 之间所有通信通过类型化的 `messaging.ts` 封装使用 `chrome.runtime.sendMessage`
- 内容去重使用 SHA-256 内容哈希，避免重复索引未变化的页面
- 语义搜索服务是独立的本地 Python 服务，不在本仓库中

## 测试

无单元测试框架。E2E 测试为 `crx/test-*.mjs` 中的独立 Puppeteer 脚本，启动带扩展的 Chrome 浏览器，导航页面，通过 background service worker 验证 IndexedDB 内容。
