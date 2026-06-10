<template>
  <div class="settings-overlay">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>设置</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="settings-body">
        <div class="setting-item">
          <label>本地服务地址</label>
          <input
            v-model="localServiceUrl"
            type="text"
            placeholder="http://localhost:8199"
          />
          <span class="hint">语义搜索需要运行本地 Python 服务</span>
        </div>

        <div class="setting-item">
          <label>
            <input type="checkbox" v-model="captureEnabled" />
            启用页面内容捕获
          </label>
        </div>

        <div class="setting-item">
          <label>排除的 URL 模式（每行一个）</label>
          <textarea
            v-model="excludePatternsText"
            placeholder="例: *://*.example.com/*"
            rows="3"
          ></textarea>
        </div>

        <div class="setting-item danger-zone">
          <label>数据管理</label>
          <div class="clear-row">
            <span class="hint">{{ dataInfo }}</span>
            <template v-if="confirmClear">
              <button class="clear-btn confirm" @click="doClear">确认清除</button>
              <button class="clear-btn cancel" @click="confirmClear = false">取消</button>
            </template>
            <button v-else class="clear-btn" @click="confirmClear = true" :disabled="clearing">
              {{ clearing ? '清除中...' : '清除所有数据' }}
            </button>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="save-btn" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettings } from '@/composables/useSettings';

defineEmits<{
  close: [];
}>();

const { settings, loadSettings, saveSettings } = useSettings();

const localServiceUrl = ref('http://localhost:8199');
const captureEnabled = ref(true);
const excludePatternsText = ref('');
const clearing = ref(false);
const confirmClear = ref(false);
const dataInfo = ref('');

async function loadDataInfo() {
  try {
    const db = await new Promise<any>((resolve, reject) => {
      const req = indexedDB.open('knowsearch-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const pageCount = await new Promise<number>((resolve, reject) => {
      const req = db.transaction('pages', 'readonly').objectStore('pages').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dataInfo.value = `已存储 ${pageCount} 条页面记录`;
  } catch {
    dataInfo.value = '无法读取数据';
  }
}

onMounted(async () => {
  await loadSettings();
  localServiceUrl.value = settings.value.pythonServiceUrl;
  captureEnabled.value = settings.value.captureEnabled;
  excludePatternsText.value = settings.value.excludePatterns.join('\n');
  await loadDataInfo();
});

async function save() {
  await saveSettings({
    pythonServiceUrl: localServiceUrl.value,
    captureEnabled: captureEnabled.value,
    excludePatterns: excludePatternsText.value.split('\n').filter((p) => p.trim()),
  });
}

async function doClear() {
  confirmClear.value = false;
  clearing.value = true;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('knowsearch-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const pagesDeleted = await new Promise<number>((resolve, reject) => {
      const req = db.transaction('pages', 'readonly').objectStore('pages').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const termsDeleted = await new Promise<number>((resolve, reject) => {
      const req = db.transaction('search-terms', 'readonly').objectStore('search-terms').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['pages', 'search-terms'], 'readwrite');
      tx.objectStore('pages').clear();
      tx.objectStore('search-terms').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dataInfo.value = `已清除 ${pagesDeleted} 条页面、${termsDeleted} 个索引词`;
  } catch (err: any) {
    dataInfo.value = `清除失败: ${err?.message || err}`;
  } finally {
    clearing.value = false;
  }
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.settings-panel {
  background: #fff;
  border-radius: 8px;
  width: 360px;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.settings-header h2 {
  font-size: 14px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}

.settings-body {
  padding: 12px 16px;
}

.setting-item {
  margin-bottom: 12px;
}

.setting-item label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #555;
  margin-bottom: 4px;
}

.setting-item input[type="text"],
.setting-item textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}

.setting-item input[type="text"]:focus,
.setting-item textarea:focus {
  border-color: #4a90d9;
}

.setting-item input[type="checkbox"] {
  margin-right: 6px;
}

.hint {
  display: block;
  font-size: 11px;
  color: #aaa;
  margin-top: 2px;
}

.settings-footer {
  padding: 8px 16px 12px;
  text-align: right;
}

.save-btn {
  padding: 6px 16px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.save-btn:hover {
  background: #3a7bc8;
}

.danger-zone {
  border-top: 1px solid #eee;
  padding-top: 12px;
}

.clear-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.clear-btn {
  padding: 4px 12px;
  background: #fff;
  color: #d93025;
  border: 1px solid #d93025;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.clear-btn:hover:not(:disabled) {
  background: #d93025;
  color: #fff;
}

.clear-btn.confirm {
  background: #d93025;
  color: #fff;
  border-color: #d93025;
}

.clear-btn.cancel {
  color: #666;
  border-color: #ccc;
}

.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
