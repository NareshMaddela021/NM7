import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { LIVE, http } from './services/http';
import { syncPrices } from './lib/pricing';
import { ThemeProvider } from './lib/theme';
import { FlowProvider } from './lib/flow';
import { ToastProvider } from './components/ui';
import './styles/tokens.css';
import './styles/base.css';

// Referral links (nm7.si/?ref=CODE): remember the code for sign-up in this tab.
try { const ref = new URLSearchParams(window.location.search).get('ref'); if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) sessionStorage.setItem('nm7-ref', ref.toUpperCase()); } catch { /* ignore */ }

// Preview builds (no server rewrites) use hash URLs: /#/builder
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter;

const tree = () => (
  <React.StrictMode>
    <Router>
      <ThemeProvider>
        <FlowProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </FlowProvider>
      </ThemeProvider>
    </Router>
  </React.StrictMode>
);
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(tree());
// Live: prices come from the server (the owner can change them); show them once loaded.
if (LIVE) syncPrices(http).then(() => root.render(tree()), () => {});
