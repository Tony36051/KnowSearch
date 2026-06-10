import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'KnowSearch',
    description: '搜索你的浏览历史 - 用自然语言找到看过的页面',
    version: '1.0.0',
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'activeTab',
    ],
    host_permissions: [
      '<all_urls>',
    ],
  },
});
