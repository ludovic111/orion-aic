import { useCallback, useEffect, useState } from "react";
import {
  isDarkPalette,
  isLightPalette,
  paletteOf,
  type PaletteId,
} from "./palettes";
import { initialLang, isLang, setLang, type Lang } from "../i18n";
import type { Module } from "../../shared/links";
import { migrateDock } from "./dock.ts";

// Preferences of this post (this browser). Not part of the session: another
// post keeps its own theme, printer options and visible modules.
export type Prefs = {
  theme: "dark" | "light" | "auto";
  /** Colour theme used in light mode (see palettes.ts). */
  lightPalette: PaletteId;
  /** Colour theme used in dark mode. */
  darkPalette: PaletteId;
  motion: "full" | "reduced";
  /** Modules hidden from the navigation (dock and « Plus d'outils »). */
  hidden: string[];
  /**
   * Modules shown directly in the dock; the others are under « Plus
   * d'outils ». null: automatic, from the function of the post (dock.ts).
   */
  dock: Module[] | null;
  /** Names of the modules under their icons (off: compact dock). */
  dockLabels: boolean;
  /** « Par où commencer ? » was closed on this post. */
  startDone: boolean;
  /** Situation shows every card (off: the essential ones). */
  situationFull: boolean;
  /** Print each new journal entry as soon as it is recorded. */
  autoPrint: boolean;
  /** Also print entries recorded on other synchronised posts. */
  autoPrintRemote: boolean;
  /** Print each new message of the intake. */
  autoPrintMessages: boolean;
  /** Details level of the documentation. */
  docsLevel: "short" | "guide" | "full";
  /** Microphone button for voice dictation (off: audio may leave the post). */
  dictation: boolean;
  /** Language of the interface on this post (default: the browser's). */
  lang: Lang;
};
const KEY = "orion-aic-prefs";
export const DEFAULT_PREFS: Prefs = {
  theme: "light",
  lightPalette: "papier",
  darkPalette: "graphite",
  motion: "full",
  hidden: [],
  dock: null,
  dockLabels: true,
  startDone: false,
  situationFull: false,
  autoPrint: false,
  autoPrintRemote: false,
  autoPrintMessages: false,
  docsLevel: "guide",
  dictation: false,
  lang: "fr",
};
// The editorial design (cream paper) replaced the deep-space look: posts
// still on the former default dark theme switch to it once.
const DESIGN = "orion-aic-design";
function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : null;
    const prefs: Prefs =
      stored && typeof stored === "object"
        ? { ...DEFAULT_PREFS, ...stored, ...migrateDock(stored) }
        : { ...DEFAULT_PREFS, lang: initialLang() };
    // A palette removed or mistyped falls back to the default of its mode.
    if (!isLightPalette(prefs.lightPalette))
      prefs.lightPalette = DEFAULT_PREFS.lightPalette;
    if (!isDarkPalette(prefs.darkPalette))
      prefs.darkPalette = DEFAULT_PREFS.darkPalette;
    if (typeof prefs.dictation !== "boolean") prefs.dictation = false;
    for (const key of ["dockLabels", "startDone", "situationFull"] as const)
      if (typeof prefs[key] !== "boolean") prefs[key] = DEFAULT_PREFS[key];
    if (!isLang(prefs.lang)) prefs.lang = initialLang();
    if (localStorage.getItem(DESIGN) !== "atelier") {
      localStorage.setItem(DESIGN, "atelier");
      if (prefs.theme === "dark") return { ...prefs, theme: "light" };
    }
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS, lang: initialLang() };
  }
}
export function usePrefs() {
  const [prefs, set] = useState<Prefs>(read);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const light =
        prefs.theme === "light" ||
        (prefs.theme === "auto" &&
          matchMedia("(prefers-color-scheme: light)").matches);
      root.dataset.theme = light ? "light" : "dark";
      const palette = light ? prefs.lightPalette : prefs.darkPalette;
      root.dataset.palette = palette;
      root.dataset.motion =
        prefs.motion === "reduced" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "reduced"
          : "full";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          paletteOf(palette)?.swatch[0] ?? (light ? "#e4dfd9" : "#121110"),
        );
    };
    apply();
    const media = matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs.theme, prefs.motion, prefs.lightPalette, prefs.darkPalette]);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    // The language changes at once, before the next render reads it.
    if (patch.lang) setLang(patch.lang);
    set((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  return [prefs, setPrefs] as const;
}
