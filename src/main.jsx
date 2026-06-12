console.log('APP_ID', import.meta.env.VITE_BASE44_APP_ID);
console.log('BASE_URL', import.meta.env.VITE_BASE44_APP_BASE_URL);
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
