import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true }, '/downloads': { target: 'http://127.0.0.1:4318', changeOrigin: true } } },
  build: { target: 'es2022' }
});
