/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// GitHub Pages 部署在子路径下，用 VITE_BASE 覆盖；本地与预览用 '/'
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    // 默认跑在 node 里 —— 绝大多数测试是 reducer / 规则 / 内容校验，不需要 DOM，
    // 给它们起一个 jsdom 只是白等。
    environment: 'node',
    // 唯一需要真实 DOM 的是「打字 → 回车 → 看回显」那一层（tests/free-input-dom.test.tsx），
    // 它用文件头的 `// @vitest-environment jsdom` 单独把作用域切过去。
    // 刻意不用 environmentMatchGlobs：vitest 3 已标记它为 deprecated，每次跑都会打警告。
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
