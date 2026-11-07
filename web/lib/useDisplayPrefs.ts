"use client";

import { useCallback, useSyncExternalStore } from "react";

const THEME_KEY = "redrun:theme";
const CB_KEY = "redrun:color-blind";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

// Storage can be blocked (private windows, previews), so every access is guarded.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved, but still applied for this page through the listeners below.
    memory.set(key, value);
  }
  listeners.forEach((listener) => listener());
}

const memory = new Map<string, string>();
const get = (key: string) => memory.get(key) ?? read(key);

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

/** Dark mode (follows the system until toggled) and the color-blind palette, remembered per browser. */
export function useDisplayPrefs() {
  const theme = useSyncExternalStore(subscribe, () => get(THEME_KEY) ?? "system", () => "system");
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const colorBlind = useSyncExternalStore(subscribe, () => get(CB_KEY) === "1", () => false);
  const dark = theme === "dark" || (theme === "system" && systemDark);

  const toggleDark = useCallback(() => write(THEME_KEY, dark ? "light" : "dark"), [dark]);
  const toggleColorBlind = useCallback(() => write(CB_KEY, colorBlind ? "0" : "1"), [colorBlind]);
  return { dark, colorBlind, toggleDark, toggleColorBlind };
}
