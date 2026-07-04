import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// ===== الخطوط المضمّنة محلياً (تعمل بدون إنترنت) =====
// Noto Kufi Arabic — الخط الأساسي للبرنامج (واضح واحترافي)
import '@fontsource/noto-kufi-arabic/400.css'
import '@fontsource/noto-kufi-arabic/500.css'
import '@fontsource/noto-kufi-arabic/600.css'
import '@fontsource/noto-kufi-arabic/700.css'
// IBM Plex Sans Arabic — احتياطي
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
// IBM Plex Sans — للإنجليزية والأرقام
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'

import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
