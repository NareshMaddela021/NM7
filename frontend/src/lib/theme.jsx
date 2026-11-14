import { createContext, useContext, useEffect, useState } from 'react';

const ThemeCtx = createContext({ theme: 'light', toggle: () => {} });

// The new design (round P) is light only for now: every page is light, whatever the phone's setting or an older
// saved choice. The provider and hook stay, so a dark theme can come back later in one place.
function initialTheme() {
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('asuraa-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const toggle = () => setTheme('light');
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
