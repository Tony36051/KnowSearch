// wxt.config.ts
import { defineConfig } from 'wxt';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  manifest: {
    name: isDev ? '[DEV] My Extension' : 'My Extension',
    description: 'A sample extension',
    version: '1.0.0',
  },
  ...(isDev && {
    persistentId: 'my-extension-dev-id',
  }),
});