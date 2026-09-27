import type { Module } from "../../shared/links";
import { MODULE_IDS } from "./modules.ts";

// Which modules the dock shows directly and which wait behind « Plus
// d'outils ». Pure functions (tested in tests/dock.test.mjs): the shell
// passes the preferences of the post and the modules its function works in.
//
// Three places for a module:
// - the dock itself (« barre »): what this post uses all the time;
// - « Plus d'outils »: one tap away, with a sentence saying what it is for;
// - hidden (prefs.hidden): out of the navigation, data untouched.

/** Always shown in the dock, cannot be hidden or moved. */
export const PINNED: Module[] = ["situation", "journal"];
/** Cannot be hidden (Aide sits at the foot of the dock). */
export const CORE: Module[] = ["situation", "journal", "docs"];
/** The dock of a post without a function, or before any change. */
export const ESSENTIAL: Module[] = [
  "situation",
  "journal",
  "messages",
  "tasks",
  "map",
  "resources",
  "team",
];
/** Order of preference for the four places of a phone's bottom bar. */
export const PHONE_PRIORITY: Module[] = [
  "situation",
  "journal",
  "messages",
  "map",
  "tasks",
  "resources",
  "team",
  "missions",
];
/** Places of a phone's bottom bar before « Plus ». */
export const PHONE_SLOTS = 4;

const known = (id: unknown): id is Module =>
  typeof id === "string" && (MODULE_IDS as string[]).includes(id);
const unique = <T>(list: T[]) => [...new Set(list)];

/**
 * The modules shown in the dock when the post has not chosen: the essential
 * ones and those its function works in most (src/post/roles.ts).
 */
export function defaultDock(focus: readonly Module[] = []): Module[] {
  return unique([...ESSENTIAL, ...focus.filter(known)]);
}

export type DockPrefs = {
  /** Modules hidden from the navigation. */
  hidden: string[];
  /** Modules chosen for the dock; null: automatic (defaultDock). */
  dock: Module[] | null;
};

export type DockLayout = {
  /** Shown in the dock, in the order of MODULES (Aide excluded). */
  bar: Module[];
  /** Behind « Plus d'outils », in the order of MODULES. */
  more: Module[];
};

/** Where each visible module goes. Aide (docs) is always at the foot. */
export function dockLayout(
  prefs: DockPrefs,
  focus: readonly Module[] = [],
): DockLayout {
  const chosen = prefs.dock ?? defaultDock(focus);
  const visible = MODULE_IDS.filter(
    (m) => m !== "docs" && (CORE.includes(m) || !prefs.hidden.includes(m)),
  );
  const inBar = (m: Module) => PINNED.includes(m) || chosen.includes(m);
  return {
    bar: visible.filter(inBar),
    more: visible.filter((m) => !inBar(m)),
  };
}

/** The four modules of a phone's bottom bar, taken from the dock. */
export function phoneBar(bar: readonly Module[]): Module[] {
  const ranked = [
    ...PHONE_PRIORITY.filter((m) => bar.includes(m)),
    ...bar.filter((m) => !PHONE_PRIORITY.includes(m)),
  ];
  return MODULE_IDS.filter((m) => ranked.slice(0, PHONE_SLOTS).includes(m));
}

export type Placement = "bar" | "more" | "hidden";

/** Where a module is now. */
export function placementOf(
  prefs: DockPrefs,
  id: Module,
  focus: readonly Module[] = [],
): Placement {
  if (id === "docs" || PINNED.includes(id)) return "bar";
  if (prefs.hidden.includes(id)) return "hidden";
  return dockLayout(prefs, focus).bar.includes(id) ? "bar" : "more";
}

/**
 * Move a module; the automatic dock becomes an explicit choice from then
 * on. Situation, Journal and Aide stay where they are.
 */
export function place(
  prefs: DockPrefs,
  id: Module,
  where: Placement,
  focus: readonly Module[] = [],
): DockPrefs {
  if (CORE.includes(id)) return prefs;
  const chosen = (prefs.dock ?? defaultDock(focus)).filter((m) => m !== id);
  const hidden = prefs.hidden.filter((m) => m !== id);
  return {
    hidden: where === "hidden" ? [...hidden, id] : hidden,
    dock: where === "bar" ? [...chosen, id] : chosen,
  };
}

/**
 * Preferences stored before the dock had two levels. A post that had hidden
 * modules chose its navigation by hand: every module it kept stays in the
 * dock. A post that never changed anything gets the new automatic dock.
 * Unknown ids are dropped; anything malformed falls back to automatic.
 */
export function migrateDock(stored: Record<string, unknown>): DockPrefs {
  const hidden = Array.isArray(stored.hidden)
    ? unique(stored.hidden.filter(known)).filter((m) => !CORE.includes(m))
    : [];
  if ("dock" in stored) {
    const dock = Array.isArray(stored.dock)
      ? unique(stored.dock.filter(known))
      : null;
    return { hidden, dock };
  }
  if (!hidden.length) return { hidden, dock: null };
  return {
    hidden,
    dock: MODULE_IDS.filter((m) => m !== "docs" && !hidden.includes(m)),
  };
}
