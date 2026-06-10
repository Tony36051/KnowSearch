import { ref, watch } from 'vue';
import { sendMessage, type SearchPagesResponse, type SearchResult } from '@/lib/messaging';

export function useSearch() {
  const query = ref('');
  const results = ref<SearchResult[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const mode = ref<'keyword' | 'semantic'>('keyword');
  const total = ref(0);
  const resultMode = ref<'keyword' | 'semantic' | 'fallback'>('keyword');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const performSearch = async () => {
    if (!query.value.trim()) {
      results.value = [];
      total.value = 0;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const response = await sendMessage<SearchPagesResponse>('searchPages', {
        query: query.value,
        mode: mode.value,
        limit: 20,
      });
      results.value = response.results;
      total.value = response.total;
      resultMode.value = response.mode;
    } catch (e) {
      error.value = '搜索失败';
      results.value = [];
    } finally {
      loading.value = false;
    }
  };

  const debouncedSearch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performSearch, 300);
  };

  watch(query, debouncedSearch);

  return { query, results, loading, error, mode, total, resultMode, performSearch };
}
