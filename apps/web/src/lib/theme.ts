import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'leadgen-theme';

/** The saved choice, or the computer's setting when nobody has picked yet. */
export function resolveTheme(saved: string | null, systemPrefersDark: boolean): Theme {
  if (saved === 'light' || saved === 'dark') return saved;
  return systemPrefersDark ? 'dark' : 'light';
}

function read(): Theme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked; the system setting is a fine fallback.
  }
  return resolveTheme(saved, window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Current theme plus a toggle that remembers the choice. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  // Follow the computer's setting until the user picks one themselves.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        return;
      }
      setTheme(query.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Not saved, still applied for this visit.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
