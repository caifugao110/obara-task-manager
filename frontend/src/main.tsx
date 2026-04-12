import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { setupAxiosInterceptors } from './utils/axios'

// Setup axios interceptors
setupAxiosInterceptors()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
