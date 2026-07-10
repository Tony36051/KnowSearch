<template>
  <div class="knowsearch-popup">
    <div class="header">
      <h1>KnowSearch</h1>
      <div class="header-actions">
        <button class="history-btn" @click="openHistory">全屏查看</button>
        <button class="settings-btn" @click="showSettings = true">设置</button>
      </div>
    </div>

    <div class="search-section">
      <SearchInput v-model="query" />
    </div>

    <div class="result-info" v-if="!pageLoading && allPages.length > 0">
      <span v-if="query.trim()">{{ filteredPages.length }} / {{ allPages.length }}</span>
      <span v-else>{{ allPages.length }} 条记录</span>
    </div>

    <div class="page-list" ref="listRef" @scroll="onScroll">
      <div v-if="pageLoading" class="status">加载中...</div>
      <div v-else-if="pageError" class="status error">{{ pageError }}</div>
      <div v-else-if="filteredPages.length === 0" class="status">{{ query ? '未找到相关页面' : '暂无浏览记录' }}</div>
      <template v-else>
        <div v-for="page in visiblePages" :key="page.id" class="page-item" @click="openPage(page)">
          <div class="item-header">
            <img v-if="page.favicon" :src="page.favicon" class="favicon" alt="" />
            <span class="title">{{ page.title }}</span>
          </div>
          <div class="url">{{ page.url }}</div>
          <div class="excerpt">{{ page.excerpt }}</div>
          <div class="meta">
            {{ formatTime(page.lastVisitedAt) }}
            <span v-if="page.visitCount > 1">({{ page.visitCount }}次)</span>
            <button class="view-indexed-btn" @click.stop="viewIndexedContent(page)">索引内容</button>
          </div>
        </div>
        <div v-if="visibleCount < filteredPages.length" class="load-more">向下滚动加载更多</div>
      </template>
    </div>

    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { PageContentResponse } from '@/lib/messaging';
import SearchInput from '@/components/SearchInput.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';

const PAGE_SIZE = 20;

const allPages = ref<PageContentResponse[]>([]);
const pageLoading = ref(true);
const pageError = ref<string | null>(null);
const query = ref('');
const showSettings = ref(false);
const visibleCount = ref(PAGE_SIZE);
const listRef = ref<HTMLElement | null>(null);

const filteredPages = computed(() => {
  if (!query.value.trim()) return allPages.value;
  const q = query.value.toLowerCase();
  return allPages.value.filter(
    (p) => p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q),
  );
});

const visiblePages = computed(() => filteredPages.value.slice(0, visibleCount.value));

watch(query, () => { visibleCount.value = PAGE_SIZE; });

function onScroll() {
  const el = listRef.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
    if (visibleCount.value < filteredPages.value.length) {
      visibleCount.value += PAGE_SIZE;
    }
  }
}

onMounted(async () => {
  try {
    const res = await sendMessage<{ pages: PageContentResponse[] }>('getAllPages');
    allPages.value = res.pages.reverse();
  } catch {
    pageError.value = '加载失败';
  } finally {
    pageLoading.value = false;
  }
});

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

function openPage(page: PageContentResponse) {
  browser.tabs.create({ url: page.url });
}

function viewIndexedContent(page: PageContentResponse) {
  browser.tabs.create({ url: browser.runtime.getURL(`/indexed-content.html?id=${page.id}`) });
}

function openHistory() {
  browser.tabs.create({ url: browser.runtime.getURL('/history.html') });
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 400px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>

<style scoped>
.knowsearch-popup {
  display: flex;
  flex-direction: column;
  min-height: 300px;
  max-height: 500px;
  background: #fff;
}

.header {
  padding: 12px 16px 8px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.history-btn {
  padding: 3px 10px;
  font-size: 12px;
  color: #4a90d9;
  background: none;
  border: 1px solid #4a90d9;
  border-radius: 4px;
  cursor: pointer;
}

.history-btn:hover {
  background: #4a90d9;
  color: #fff;
}

.settings-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
}

.settings-btn:hover {
  color: #333;
}

.search-section {
  padding: 8px 12px;
}

.result-info {
  padding: 4px 12px;
  font-size: 11px;
  color: #888;
}

.page-list {
  flex: 1;
  overflow-y: auto;
}

.status {
  text-align: center;
  padding: 24px 12px;
  color: #888;
  font-size: 13px;
}

.status.error {
  color: #d93025;
}

.load-more {
  text-align: center;
  padding: 8px;
  font-size: 11px;
  color: #bbb;
}

.page-item {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  transition: background 0.15s;
}

.page-item:hover {
  background: #f5f7fa;
}

.page-item:last-child {
  border-bottom: none;
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
  font-size: 13px;
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
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
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
