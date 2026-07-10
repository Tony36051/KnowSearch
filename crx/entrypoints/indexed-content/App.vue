<template>
  <div class="indexed-content-page">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="page" class="content-wrapper">
      <header class="page-header">
        <div class="header-top">
          <h1 class="page-title">{{ page.title }}</h1>
          <button class="open-original-btn" @click="openOriginal">打开原文</button>
        </div>
        <div class="page-meta">
          <span class="meta-url">{{ page.url }}</span>
        </div>
        <div class="page-info">
          <span>首次访问: {{ formatTime(page.firstVisitedAt) }}</span>
          <span>最近访问: {{ formatTime(page.lastVisitedAt) }}</span>
          <span>访问 {{ page.visitCount }} 次</span>
          <span>文本 {{ page.textLength }} 字符</span>
        </div>
        <div class="storage-info">
          页面记录: {{ formatSize(storage?.pageRecordSize || 0) }}
          | 索引词: {{ formatSize(storage?.indexTermsSize || 0) }}
          | 数据库总量: {{ formatSize(storage?.totalDbUsage || 0) }}
          <span v-if="storage?.totalDbQuota">/ {{ formatSize(storage.totalDbQuota) }}</span>
          | 索引词项: {{ terms.length }} 个
        </div>
      </header>

      <div class="text-content" v-html="highlightedHtml"></div>

      <div v-if="totalPages > 1" class="pagination">
        <button :disabled="currentPage === 0" @click="currentPage--">上一页</button>
        <span>第 {{ currentPage + 1 }} / {{ totalPages }} 页</span>
        <button :disabled="currentPage >= totalPages - 1" @click="currentPage++">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { sendMessage } from '@/lib/messaging';
import type { PageContentResponse, PageTermsResponse, StorageEstimateResponse } from '@/lib/messaging';
import { highlightTerms } from '@/lib/highlight';

const CHARS_PER_PAGE = 5000;

const pageId = new URLSearchParams(window.location.search).get('id') || '';
const page = ref<PageContentResponse | null>(null);
const terms = ref<string[]>([]);
const storage = ref<StorageEstimateResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const currentPage = ref(0);

const textChunks = computed(() => {
  const text = page.value?.text || '';
  if (!text) return [];
  const paragraphs = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length + 1 > CHARS_PER_PAGE && current.length > 0) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + '\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
});

const totalPages = computed(() => textChunks.value.length);
const currentChunk = computed(() => textChunks.value[currentPage.value] || '');
const highlightedHtml = computed(() => highlightTerms(currentChunk.value, terms.value));

onMounted(async () => {
  try {
    const [contentRes, termsRes, storageRes] = await Promise.all([
      sendMessage<PageContentResponse | null>('getPageContent', { pageId }),
      sendMessage<PageTermsResponse>('getPageTerms', { pageId }),
      sendMessage<StorageEstimateResponse>('getStorageEstimate', { pageId }),
    ]);
    page.value = contentRes;
    terms.value = termsRes.terms;
    storage.value = storageRes;
  } catch (e) {
    error.value = '加载失败';
  } finally {
    loading.value = false;
  }
});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openOriginal() {
  if (page.value) {
    window.open(page.value.url, '_blank');
  }
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
  background: #fafafa;
  color: #333;
}
</style>

<style scoped>
.indexed-content-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
}

.loading, .error {
  text-align: center;
  padding: 48px;
  font-size: 16px;
  color: #888;
}

.error {
  color: #d93025;
}

.content-wrapper {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 24px;
}

.page-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  line-height: 1.4;
}

.open-original-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  font-size: 13px;
  color: #4a90d9;
  background: none;
  border: 1px solid #4a90d9;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.open-original-btn:hover {
  background: #4a90d9;
  color: #fff;
}

.page-meta {
  margin-top: 8px;
}

.meta-url {
  font-size: 12px;
  color: #888;
  word-break: break-all;
}

.page-info {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #666;
}

.storage-info {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
  color: #555;
}

.text-content {
  line-height: 1.8;
  font-size: 15px;
  white-space: pre-wrap;
  word-break: break-word;
}

.text-content :deep(.indexed-term) {
  background: #fff3b0;
  padding: 1px 2px;
  border-radius: 2px;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
  font-size: 14px;
  color: #666;
}

.pagination button {
  padding: 6px 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #333;
}

.pagination button:hover:not(:disabled) {
  background: #f5f7fa;
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
