"use client";

import * as React from "react";
import {
  applyAppearanceTokens,
  DEFAULT_APPEARANCE,
  parseAppearanceTokens,
  readCachedAppearance,
  writeCachedAppearance,
  type AppearanceTokens,
} from "@/lib/theme/appearance-tokens";
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
  appearance: AppearanceTokens;
  setState: (next: ThemeState) => void;
  setMode: (mode: ThemeMode) => void;
  applyAppearance: (tokens: AppearanceTokens) => void;
  reset: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = React.useState<ThemeState>(DEFAULT_THEME_STATE);
  const [appearance, setAppearance] = React.useState<AppearanceTokens>(DEFAULT_APPEARANCE);

  React.useEffect(() => {
    const initial = parseThemeState(window.localStorage.getItem(THEME_STORAGE_KEY));
    const cached = readCachedAppearance();
    setStateRaw(initial);
    setAppearance(cached);
    applyThemeState(document.documentElement, initial);
    applyAppearanceTokens(document.documentElement, cached);

    let cancelled = false;
    if (typeof fetch === "function") {
      fetch("/api/settings/appearance")
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (cancelled || !json?.data?.theme) return;
          const next = parseAppearanceTokens(json.data.theme);
          setAppearance(next);
          applyAppearanceTokens(document.documentElement, next);
          writeCachedAppearance(next);
        })
        .catch(() => {
          /* guest / 401 — tetap pakai cache */
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const commit = React.useCallback((next: ThemeState) => {
    setStateRaw(next);
    applyThemeState(document.documentElement, next);
    window.localStorage.setItem(THEME_STORAGE_KEY, serializeThemeState(next));
  }, []);

  const applyAppearance = React.useCallback((tokens: AppearanceTokens) => {
    const next = parseAppearanceTokens(tokens);
    setAppearance(next);
    applyAppearanceTokens(document.documentElement, next);
    writeCachedAppearance(next);
    setStateRaw((prev) => {
      const synced: ThemeState = {
        ...prev,
        presetId: next.presetId,
        customPrimary: next.base.primary,
        customSecondary: next.base.secondary,
      };
      window.localStorage.setItem(THEME_STORAGE_KEY, serializeThemeState(synced));
      return synced;
    });
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      appearance,
      setState: commit,
      setMode: (mode) => commit({ ...state, mode }),
      applyAppearance,
      reset: () => {
        commit(DEFAULT_THEME_STATE);
        applyAppearance(DEFAULT_APPEARANCE);
      },
    }),
    [state, appearance, commit, applyAppearance]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
