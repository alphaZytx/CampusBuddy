import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { isNativeApp } from './lib/server';
import { AuthProvider } from './state/auth';
import { ToastProvider } from './state/toast';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

// Production web builds only: in development a service worker would cache files that
// Vite is still changing, and the Android app already carries its files with it.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
