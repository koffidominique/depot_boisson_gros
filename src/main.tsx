import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerPWA } from './lib/pwa';

registerPWA(
  () => {
    // Nouvelle version du SW disponible — le composant PWAUpdatePrompt s'en charge via le callback global.
    const evt = new CustomEvent('gestdepot:pwa-update');
    window.dispatchEvent(evt);
  },
  () => {
    // Application prête à fonctionner hors-ligne.
    const evt = new CustomEvent('gestdepot:pwa-offline-ready');
    window.dispatchEvent(evt);
  }
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => {
    // Marquer l'app comme prête hors-ligne une fois le SW activé.
    window.dispatchEvent(new CustomEvent('gestdepot:pwa-offline-ready'));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
