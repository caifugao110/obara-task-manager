import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { setupAxiosInterceptors } from './utils/axios'
import { startBackendHeartbeat } from './services/api'

// Setup axios interceptors
setupAxiosInterceptors()

// 全局后端心跳：统一驱动 server-online / server-unreachable 广播，替代各页面各自的探测
startBackendHeartbeat()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
