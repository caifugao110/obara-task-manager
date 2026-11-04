import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 默认把整个 npm workspace 根目录（含 backend/）作为 /@fs/ 的允许范围。
// 前端端口对局域网开放时，任何人访问 /@fs/<绝对路径> 就能直接下载
// backend/data.db、logs/ 等文件。这里把允许范围收窄到前端目录与提升到根目录的依赖，
// 并显式拒绝数据库、日志、备份和环境变量文件。
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const workspaceNodeModules = fileURLToPath(new URL('../node_modules', import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/obara-task-manager/' : '/',
  build: {
    // 按路由懒加载后页面 chunk 体积普遍偏大，放宽告警阈值避免噪音
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 依赖按稳定性分组：业务代码变更时用户无需重新下载这些 vendor chunk
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-socket': ['socket.io-client'],
          'vendor-icons': ['lucide-react'],
          'vendor-utils': ['axios', 'date-fns']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    fs: {
      strict: true,
      allow: [frontendRoot, workspaceNodeModules],
      deny: [
        '**/backend/**',
        '**/logs/**',
        '**/backups/**',
        '**/*.db',
        '**/*.db-*',
        '**/*.log',
        '**/.env',
        '**/.env.*',
        '**/.git/**'
      ]
    },
    // 本项目部署在网络驱动器上（F: 为映射的网络磁盘），Node 的 fs.watch
    // 在这种盘上会抛出 "UNKNOWN: unknown error, watch"（errno -4094），
    // 导致 Vite 的 chokidar 监听器报错并直接终止 dev server。
    // 改为轮询监听可完全绕开 fs.watch，代价是文件变更最多延迟 1 秒生效。
    watch: {
      usePolling: true,
      interval: 1000
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        // 将真实客户端 IP 写入 X-Forwarded-For，否则后端只能看到代理地址 127.0.0.1
        xfwd: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        xfwd: true,
        ws: true
      }
    }
  }
})