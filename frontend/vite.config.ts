import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/obara-task-manager/' : '/',
  server: {
    host: '0.0.0.0',
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