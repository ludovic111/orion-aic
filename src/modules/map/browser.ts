// What the map remembers in this browser (localStorage) and what the screen
// allows. Pure: storage and window are only read when a function is called.

export type View = { lat: number; lng: number; zoom: number };

export const isRecord = (v: unknown) =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const isView = (v: unknown): v is View =>
  !!v &&
  typeof v === "object" &&
  Number.isFinite((v as View).lat) &&
  Number.isFinite((v as View).lng) &&
  Number.isFinite((v as View).zoom);

export function readStore<T>(
  key: string,
  fallback: T,
  ok: (v: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return ok(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: preferences simply are not remembered.
  }
}

export const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const narrow = () => window.innerWidth <= 900;
/** Touch screen: an object is moved only once selected. */
export const coarse = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
