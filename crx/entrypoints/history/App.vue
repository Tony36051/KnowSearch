<template>
  <div class="history-page">
    <header class="page-header">
      <h1>KnowSearch 浏览历史</h1>
      <button class="settings-btn" @click="showSettings = true">设置</button>
    </header>

    <div class="summary-bar" v-if="stats">
      <span>{{ dateRange }}</span>
      <span>{{ stats.pageCount }} 个页面</span>
      <span>{{ stats.totalTextLength.toLocaleString() }} 字</span>
      <span>页面 {{ formatSize(stats.pagesSize) }} + 索引 {{ formatSize(stats.termsSize) }}</span>
      <button class="clear-btn" @click="confirmClear = true">清除全部</button>
    </div>

    <div class="clear-confirm" v-if="confirmClear">
      <span>确认清除所有浏览记录和索引？</span>
      <button class="confirm-yes" @click="doClear" :disabled="clearing">{{ clearing ? '清除中...' : '确认' }}</button>
      <button class="confirm-no" @click="confirmClear = false">取消</button>
    </div>

    <div class="search-bar">
      <SearchInput v-model="query" />
    </div>

    <div v-if="loading" class="status">加载中...</div>
    <div v-else-if="pageError" class="status error">{{ pageError }}</div>
    <template v-else>
      <div class="result-info">
        <span v-if="query">{{ filteredPages.length }} / {{ allPages.length }} 条结果</span>
        <span v-else>共 {{ allPages.length }} 条记录</span>
      </div>
      <div class="page-list" ref="listRef">
        <div v-for="page in visiblePages" :key="page.id" class="page-item" @click="openPage(page)">
          <div class="item-header">
            <img v-if="page.favicon" :src="page.favicon" class="favicon" alt="" />
            <span class="title">{{ page.title }}</span>
          </div>
          <div class="url">{{ page.url }}</div>
          <div class="excerpt">{{ page.excerpt }}</div>
          <div class="meta">
            <span>{{ formatTime(page.lastVisitedAt) }}</span>
            <span v-if="page.visitCount > 1">{{ page.visitCount }}次访问</span>
            <span class="text-len">{{ page.textLength.toLocaleString() }} 字</span>
            <button class="view-indexed-btn" @click.stop="viewIndexedContent(page)">索引内容</button>
          </div>
        </div>
        <div v-if="visibleCount < filteredPages.length" class="load-more" ref="loadMoreRef">加载更多...</div>
      </div>
    </template>

    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { PageContentResponse, StorageStatsResponse } from '@/lib/messaging';
import SearchInput from '@/components/SearchInput.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';

const PAGE_SIZE = 20;

const allPages = ref<PageContentResponse[]>([]);
const loading = ref(true);
const pageError = ref<string | null>(null);
const query = ref('');
const showSettings = ref(false);
const stats = ref<StorageStatsResponse | null>(null);
const confirmClear = ref(false);
const clearing = ref(false);
const visibleCount = ref(PAGE_SIZE);
const loadMoreRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const filteredPages = computed(() => {
  if (!query.value.trim()) return allPages.value;
  const q = query.value.toLowerCase();
  return allPages.value.filter(
    (p) => p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q),
  );
});

const visiblePages = computed(() => filteredPages.value.slice(0, visibleCount.value));

watch(query, () => { visibleCount.value = PAGE_SIZE; });

const dateRange = computed(() => {
  if (!stats.value || stats.value.pageCount === 0) return '';
  const earliest = new Date(stats.value.earliestVisitedAt);
  const latest = new Date(stats.value.latestVisitedAt);
  const sameDay = earliest.toDateString() === latest.toDateString();
  if (sameDay) return earliest.toLocaleDateString('zh-CN');
  return `${earliest.toLocaleDateString('zh-CN')} ~ ${latest.toLocaleDateString('zh-CN')}`;
});

function loadMore() {
  if (visibleCount.value < filteredPages.value.length) {
    visibleCount.value += PAGE_SIZE;
  }
}

function setupObserver() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) loadMore();
  }, { rootMargin: '200px' });
  if (loadMoreRef.value) observer.observe(loadMoreRef.value);
}

// Test bridge: allows integration tests to trigger load-more without
// relying on IntersectionObserver (which Puppeteer cannot reliably fire).
if (typeof window !== 'undefined') {
  (window as any).__knowsearch_loadMore = loadMore;
}

onMounted(async () => {
  loading.value = true;
  pageError.value = null;
  try {
    const [pagesRes, statsRes] = await Promise.all([
      sendMessage<{ pages: PageContentResponse[] }>('getAllPages'),
      sendMessage<StorageStatsResponse>('getStorageStats'),
    ]);
    allPages.value = pagesRes.pages.reverse();
    stats.value = statsRes;
  } catch {
    pageError.value = '加载失败';
  } finally {
    loading.value = false;
  }
  setupObserver();
});

onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});

async function doClear() {
  clearing.value = true;
  try {
    await sendMessage('clearAllData');
    allPages.value = [];
    stats.value = null;
    confirmClear.value = false;
    await loadData();
  } catch {
    pageError.value = '清除失败';
  } finally {
    clearing.value = false;
  }
}

async function loadData() {
  loading.value = true;
  pageError.value = null;
  try {
    const [pagesRes, statsRes] = await Promise.all([
      sendMessage<{ pages: PageContentResponse[] }>('getAllPages'),
      sendMessage<StorageStatsResponse>('getStorageStats'),
    ]);
    allPages.value = pagesRes.pages.reverse();
    stats.value = statsRes;
  } catch {
    pageError.value = '加载失败';
  } finally {
    loading.value = false;
  }
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openPage(page: PageContentResponse) {
  window.open(page.url, '_blank');
}

function viewIndexedContent(page: PageContentResponse) {
  window.open(chrome.runtime.getURL(`/indexed-content.html?id=${page.id}`), '_blank');
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  color: #333;
}
</style>

<style scoped>
.history-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.page-header h1 {
  font-size: 20px;
  font-weight: 600;
}

.settings-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 13px;
}

.settings-btn:hover {
  color: #333;
}

.summary-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  font-size: 12px;
  color: #666;
  margin-bottom: 12px;
}

.clear-btn {
  margin-left: auto;
  padding: 3px 10px;
  font-size: 11px;
  color: #d93025;
  background: none;
  border: 1px solid #d93025;
  border-radius: 4px;
  cursor: pointer;
}

.clear-btn:hover {
  background: #d93025;
  color: #fff;
}

.clear-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fef7f0;
  border: 1px solid #f5c6a8;
  border-radius: 6px;
  font-size: 13px;
  color: #8b4513;
  margin-bottom: 12px;
}

.confirm-yes {
  padding: 3px 10px;
  font-size: 12px;
  color: #fff;
  background: #d93025;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.confirm-yes:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirm-no {
  padding: 3px 10px;
  font-size: 12px;
  color: #666;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
}

.search-bar {
  margin-bottom: 12px;
}

.status {
  text-align: center;
  padding: 48px;
  color: #888;
}

.status.error {
  color: #d93025;
}

.result-info {
  font-size: 12px;
  color: #888;
  margin-bottom: 8px;
}

.page-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.load-more {
  text-align: center;
  padding: 12px;
  font-size: 12px;
  color: #bbb;
}

.page-item {
  background: #fff;
  border-radius: 6px;
  padding: 12px 16px;
  cursor: pointer;
  transition: box-shadow 0.15s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.page-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.title {
  font-weight: 500;
  font-size: 14px;
  color: #1a73e8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url {
  font-size: 11px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.excerpt {
  font-size: 12px;
  color: #555;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.meta {
  font-size: 11px;
  color: #aaa;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.text-len {
  color: #888;
}

.view-indexed-btn {
  padding: 1px 6px;
  font-size: 10px;
  color: #4a90d9;
  background: none;
  border: 1px solid #4a90d9;
  border-radius: 3px;
  cursor: pointer;
}

.view-indexed-btn:hover {
  background: #4a90d9;
  color: #fff;
}
</style>
