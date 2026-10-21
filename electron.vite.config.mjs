import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [vue()],
    build: {
      rollupOptions: {
        output: {
          // Monaco worker 分包
          manualChunks: {
            monaco: ['monaco-editor'],
            naiveui: ['naive-ui']
          }
        }
      }
    }
  }
})
