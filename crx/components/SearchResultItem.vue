<template>
  <div class="result-item" @click="openPage">
    <div class="result-header">
      <img v-if="result.favicon" :src="result.favicon" class="favicon" alt="" />
      <span class="title">{{ result.title }}</span>
    </div>
    <div class="url">{{ result.url }}</div>
    <div class="excerpt">{{ result.excerpt }}</div>
    <div class="meta">
      访问于: {{ formatTime(result.lastVisitedAt) }}
      <span v-if="result.visitCount > 1">({{ result.visitCount }}次)</span>
      <button class="view-indexed-btn" @click.stop="viewIndexedContent">索引内容</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SearchResult } from '@/lib/messaging';

const props = defineProps<{
  result: SearchResult;
}>();

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

function openPage() {
  browser.tabs.create({ url: props.result.url });
}

function viewIndexedContent() {
  browser.tabs.create({ url: browser.runtime.getURL(`/indexed-content.html?id=${props.result.id}`) });
}
</script>

<style scoped>
.result-item {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  transition: background 0.15s;
}

.result-item:hover {
  background: #f5f7fa;
}

.result-item:last-child {
  border-bottom: none;
}

.result-header {
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
