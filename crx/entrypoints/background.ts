// entrypoints/background.ts
import { defineBackground } from 'wxt';

export default defineBackground(() => {
  console.log('Background service worker started');

  // 示例：监听浏览器点击图标事件
  browser.action.onClicked.addListener(() => {
    console.log('Extension icon clicked');
  });

  // 示例：定时任务
  setInterval(() => {
    console.log('Heartbeat from background');
  }, 60_000);
});