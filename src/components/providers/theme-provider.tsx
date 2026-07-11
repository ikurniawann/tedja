"use client";

import * as React from "react";
import {
  applyThemeState,
  DEFAULT_THEME_STATE,
  parseThemeState,
  serializeThemeState,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemeState,
} from "@/lib/theme/theme-state";

type ThemeContextValue = {
  state: ThemeState;
  setState: (next: ThemeState) => void;
  setMode: (mode: ThemeMode) => void;
  reset: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = React.useState<ThemeState>(DEFAULT_THEME_STATE);

  React.useEffect(() => {
    const initial = parseThemeState(
      window.localStorage.getItem(THEME_STORAGE_KEY)
    );
    setStateRaw(initial);
    applyThemeState(document.documentElement, initial);
  }, []);

  const commit = React.useCallback((next: ThemeState) => {
    setStateRaw(next);
    applyThemeState(document.documentElement, next);
    window.localStorage.setItem(THEME_STORAGE_KEY, serializeThemeState(next));
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      setState: commit,
      setMode: (mode) => commit({ ...state, mode }),
      reset: () => commit(DEFAULT_THEME_STATE),
    }),
    [state, commit]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
