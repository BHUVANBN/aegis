export type ThemeChoice = 'system' | 'light' | 'dark' | 'contrast';
export type Density = 'comfortable' | 'compact';
const T_KEY = 'aegis.theme';
const D_KEY = 'aegis.density';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage can be unavailable (private mode); the setting then lasts for this visit only */
  }
}
export function getTheme(): ThemeChoice {
  const v = read(T_KEY);
  return v === 'light' || v === 'dark' || v === 'contrast' ? v : 'system';
}
export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  write(T_KEY, t);
}
export function getDensity(): Density {
  return read(D_KEY) === 'compact' ? 'compact' : 'comfortable';
}
export function applyDensity(d: Density): void {
  document.documentElement.setAttribute('data-density', d);
  write(D_KEY, d);
}
export function initPreferences(): void {
  applyTheme(getTheme());
  applyDensity(getDensity());
}
