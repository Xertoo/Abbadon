import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import './index.css';
import App from './App';
import { TrayMiniPlayer } from './components/TrayMiniPlayer';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

const isTrayMode = new URLSearchParams(window.location.search).get('mode') === 'tray';

if (isTrayMode) {
  document.documentElement.classList.add('tray-mode');
  document.body.classList.add('tray-mode');
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';
}

createRoot(el).render(
  <StrictMode>
    {isTrayMode ? <TrayMiniPlayer /> : <App />}
  </StrictMode>
);