import { useCallback, useSyncExternalStore } from 'react';

/**
 * Dark or light, chosen by the caller and remembered.
 *
 * The stored value wins; with nothing stored the operating system decides once.
 * index.html applies the same rule before paint so there is no flash.
 */
export const THEME_KEY = 'ccc:theme:v1';

const root = document.documentElement;
const listeners = new Set();

function readInitial() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* private mode — fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let current = root.dataset.theme === 'light' ? 'light' : readInitial();
root.dataset.theme = current;

function apply(next) {
  current = next;
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* the choice still applies to this tab */
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current, () => current);
  const toggle = useCallback(() => apply(current === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="btn theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {next === 'light' ? 'Light' : 'Dark'}
    </button>
  );
}
