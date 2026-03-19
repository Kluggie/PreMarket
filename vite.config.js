import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

const useLocalApiIndexProxy = process.env.VITE_LOCAL_API_INDEX_PROXY === '1';

function rewriteLocalApiIndexProxy(rawPath) {
  const [pathname, search = ''] = rawPath.split('?');
  const trimmedPath = pathname.replace(/^\/api\/?/, '');
  const params = new URLSearchParams(search);

  if (trimmedPath) {
    params.set('path', trimmedPath);
  }

  const nextSearch = params.toString();
  return `/api/index${nextSearch ? `?${nextSearch}` : ''}`;
}

export default defineConfig({
  logLevel: 'error',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: useLocalApiIndexProxy
    ? {
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:3000',
            changeOrigin: true,
            rewrite: rewriteLocalApiIndexProxy,
          },
        },
      }
    : undefined,
});
