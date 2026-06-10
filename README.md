# KnowSearch

Chrome 浏览器插件 - 搜索你的浏览历史，用自然语言找到看过的页面。

## 功能

- 自动捕获浏览过的页面全文内容
- 支持 SPA 页面（Vue/React 等单页应用）
- 关键词搜索已浏览页面
- 可选的语义搜索（需本地 Python 服务）
- 访问去重与智能统计

## 开发

```bash
cd crx
pnpm install
pnpm dev        # 开发模式
pnpm build      # 生产构建
```

## 使用

1. `pnpm build` 生成 `.output/chrome-mv3/` 目录
2. Chrome 打开 `chrome://extensions/`，启用开发者模式
3. 点击"加载已解压的扩展程序"，选择 `.output/chrome-mv3/` 目录
4. 浏览网页后，点击插件图标搜索
