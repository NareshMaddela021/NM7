import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './lib/theme';
import { FlowProvider } from './lib/flow';
import { ToastProvider } from './components/ui';
import './styles/tokens.css';
import './styles/base.css';

// Preview builds (no server rewrites) use hash URLs: /#/builder
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')).render(
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
  </React.StrictMode>,
);
