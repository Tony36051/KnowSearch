<template>
  <div class="result-list">
    <div v-if="loading" class="status">搜索中...</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <div v-else-if="results.length === 0 && query" class="status">未找到相关页面</div>
    <template v-else>
      <div v-if="results.length > 0" class="result-count">
        找到 {{ total }} 条结果
        <span v-if="resultMode === 'fallback'" class="fallback-hint">(语义搜索不可可用，已使用关键词搜索)</span>
      </div>
      <SearchResultItem
        v-for="result in results"
        :key="result.id"
        :result="result"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SearchResult } from '@/lib/messaging';
import SearchResultItem from './SearchResultItem.vue';

defineProps<{
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  query: string;
  total: number;
  resultMode: 'keyword' | 'semantic' | 'fallback';
}>();
</script>

<style scoped>
.result-list {
  flex: 1;
  overflow-y: auto;
  max-height: 400px;
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

.result-count {
  padding: 6px 12px;
  font-size: 11px;
  color: #888;
  border-bottom: 1px solid #eee;
}

.fallback-hint {
  color: #d93025;
  font-style: italic;
}
</style>
