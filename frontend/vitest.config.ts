import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * 前端单测配置（与 vite.config.ts 分开）
 *
 * 为什么单独一份而不是在 vite.config.ts 里加 test 字段：
 * vite.config.ts 的 server.fs / build.manualChunks 全是构建与开发服务器相关的，
 * 混进测试配置后，任何一次构建改动都要重新确认测试环境没被带偏。两份配置各管一摊。
 *
 * 环境用 jsdom 而不是默认的 node：taskCopy 里的剪贴板兜底路径会碰
 * document / window.getSelection / execCommand，纯 node 环境跑不起来。
 */
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: frontendRoot,
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // 覆盖率只统计被测试直接覆盖的工具层，避免把 6841 行的 Dashboard 页面
    // 算进分母得出一个永远难看的数字，让人误以为测试没意义
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts'],
      reporter: ['text-summary']
    }
  }
})
