<template>
  <div class="knowsearch-popup">
    <div class="header">
      <h1>KnowSearch</h1>
    </div>

    <div class="search-section">
      <SearchInput v-model="query" />
      <div class="search-modes">
        <button :class="{ active: mode === 'keyword' }" @click="mode = 'keyword'">关键词</button>
        <button :class="{ active: mode === 'semantic' }" @click="mode = 'semantic'">语义搜索</button>
      </div>
    </div>

    <SearchResultList
      :results="results"
      :loading="loading"
      :error="error"
      :query="query"
      :total="total"
      :result-mode="resultMode"
    />

    <div class="footer">
      <span v-if="mode === 'semantic'" class="hint">语义搜索需要本地服务</span>
      <button class="settings-btn" @click="showSettings = true">设置</button>
    </div>

    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import SearchInput from '@/components/SearchInput.vue';
import SearchResultList from '@/components/SearchResultList.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import { useSearch } from '@/composables/useSearch';

const { query, results, loading, error, mode, total, resultMode } = useSearch();
const showSettings = ref(false);
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
}

.header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.search-section {
  padding: 8px 12px;
}

.search-modes {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}

.search-modes button {
  padding: 4px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #666;
}

.search-modes button.active {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  font-size: 11px;
}

.hint {
  color: #d93025;
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
</style>
