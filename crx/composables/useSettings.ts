import { ref } from 'vue';
import { sendMessage, type AppSettings } from '@/lib/messaging';

const DEFAULT_SETTINGS: AppSettings = {
  pythonServiceUrl: 'http://localhost:8199',
  captureEnabled: true,
  excludePatterns: [],
};

export function useSettings() {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const loading = ref(false);

  async function loadSettings() {
    loading.value = true;
    try {
      const response = await sendMessage<AppSettings>('getSettings');
      settings.value = { ...DEFAULT_SETTINGS, ...response };
    } catch {
      // Use defaults
    } finally {
      loading.value = false;
    }
  }

  async function saveSettings(data: Partial<AppSettings>) {
    try {
      await sendMessage('updateSettings', data);
      Object.assign(settings.value, data);
    } catch {
      // Ignore
    }
  }

  return { settings, loading, loadSettings, saveSettings };
}
