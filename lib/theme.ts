"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export const THEME_SEQUENCE: ThemeMode[] = ["system", "light", "dark"];

const KEY = "zenowork.theme";
const QUERY = "(prefers-color-scheme: dark)";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function storedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return isThemeMode(value) ? value : "system";
  } catch {
    return "system";
  }
}

function systemDark(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && systemDark());
  root.dataset.theme = mode;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    const initial = storedTheme();
    setModeState(initial);
    applyTheme(initial);

    const query = globalThis.matchMedia?.(QUERY);
    if (!query) return;
    const refresh = () => applyTheme(storedTheme());
    query.addEventListener("change", refresh);
    return () => query.removeEventListener("change", refresh);
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Preferensi tampilan boleh hilang bila storage ditolak.
    }
    applyTheme(next);
  };

  return { mode, setMode };
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_SEQUENCE.indexOf(mode);
  return THEME_SEQUENCE[(index + 1) % THEME_SEQUENCE.length] ?? "system";
}
