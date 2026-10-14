import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "online-ffmpeg-theme";

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const urlTheme = new URLSearchParams(window.location.search).get("theme") as ThemeMode | null;
  if (urlTheme === "light" || urlTheme === "dark" || urlTheme === "system") {
    return urlTheme;
  }
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Synchronously apply theme on script execution to prevent FOUC
if (typeof window !== "undefined") {
  applyTheme(getInitialTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme("system");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
  }, [theme]);

  return { theme, setTheme };
}
