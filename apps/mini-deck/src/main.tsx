import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyStoredTheme } from './lib/theme';
import './styles/ds-tokens.css';
import './styles/ds-tokens-dark.css';
import './styles/app.css';

// Set data-theme before the first paint so dark mode never flashes white.
applyStoredTheme(window.localStorage, window.matchMedia('(prefers-color-scheme: dark)').matches, document.documentElement);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
