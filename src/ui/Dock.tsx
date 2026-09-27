import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LayoutGrid, SlidersHorizontal } from "lucide-react";
import type { Module } from "../../shared/links";
import {
  MODULES,
  groupLabel,
  moduleInfo,
  type ModuleInfo,
} from "../app/modules";
import { phoneBar, type DockLayout } from "../app/dock.ts";
import { Mark } from "./Mark";
import { Popover } from "./Popover";
import { Sheet } from "./Sheet";
import { t } from "./i18n.ts";

const PHONE = "(max-width: 900px)";
/** Delay before the description of a module shows when its name is visible. */
const TIP_DELAY = 450;

function usePhone() {
  return useSyncExternalStore(
    (change) => {
      const query = matchMedia(PHONE);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

type Tip = { m: ModuleInfo; top: number; left: number };
type Badges = Partial<Record<Module, { value: number; tone?: "accent" }>>;

const count = (value: number) => (value > 99 ? "99+" : value);

/**
 * Navigation between the modules. On a computer or a tablet: a column at
 * the left, each icon with its name under it (compact: icons only), the
 * modules of this post first and « Plus d’outils » for the others, Aide at
 * the foot. On a phone: a bottom bar of four modules and « Plus ».
 * Which module goes where is decided by src/app/dock.ts.
 */
export function Dock({
  current,
  layout,
  labels,
  badges,
  onGo,
  onLogo,
  onChoose,
}: {
  current: Module;
  layout: DockLayout;
  /** Names under the icons (prefs.dockLabels). */
  labels: boolean;
  badges: Badges;
  onGo: (m: Module) => void;
  onLogo: () => void;
  /** Open the settings where the modules of the dock are chosen. */
  onChoose: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const phone = usePhone();
  const [tip, setTip] = useState<Tip | null>(null);
  const [more, setMore] = useState(false);
  const info = (ids: Module[]) => ids.map((id) => moduleInfo(id));
  // Phone: four modules in the bar, everything else in the « Plus » sheet.
  const bar = phone ? phoneBar(layout.bar) : layout.bar;
  const sheetBar = phone ? layout.bar.filter((m) => !bar.includes(m)) : [];
  const rest = phone ? [...sheetBar, ...layout.more, "docs" as Module] : [];
  const tucked = phone ? rest : layout.more;
  const inMore = tucked.includes(current);
  const moreBadge = tucked.reduce((n, m) => n + (badges[m]?.value ?? 0), 0);

  // The tooltip never outlives what it describes.
  useEffect(() => setTip(null), [current, phone]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [tip]);
  // Kept inside the viewport.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) return;
    const box = el.getBoundingClientRect();
    const top = Math.max(
      8,
      Math.min(tip.top, window.innerHeight - box.height - 8),
    );
    const left = Math.max(
      8,
      Math.min(tip.left, window.innerWidth - box.width - 8),
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [tip]);

  function hideTip() {
    clearTimeout(timer.current);
    setTip(null);
  }
  function show(m: ModuleInfo, el: HTMLElement, now = false) {
    if (matchMedia(PHONE).matches) return;
    clearTimeout(timer.current);
    const box = el.getBoundingClientRect();
    const next = {
      m,
      top: box.top + box.height / 2 - 18,
      left: box.right + 16,
    };
    // With the names shown, the sentence comes only when the pointer rests.
    if (labels && !now)
      timer.current = setTimeout(() => setTip(next), TIP_DELAY);
    else setTip(next);
  }
  // Compact dock only: icons grow near the pointer.
  function magnify(y: number | null) {
    const items = rail.current?.querySelectorAll<HTMLElement>(".dock-item");
    if (!items || labels || matchMedia(PHONE).matches) return;
    items.forEach((el) => {
      if (y === null) return el.style.setProperty("--s", "1");
      const box = el.getBoundingClientRect();
      const d = Math.abs(y - (box.top + box.height / 2));
      const s = 1 + Math.max(0, 1 - d / 110) * 0.32;
      el.style.setProperty("--s", s.toFixed(3));
    });
  }

  const item = (m: ModuleInfo, extra = "") => {
    const badge = badges[m.id];
    const Icon = m.icon;
    return (
      <button
        key={m.id}
        className={`dock-item ${extra}`}
        aria-current={current === m.id ? "page" : undefined}
        aria-label={labels || phone ? undefined : m.label}
        onClick={() => {
          hideTip();
          onGo(m.id);
        }}
        onMouseEnter={(e) => show(m, e.currentTarget)}
        onMouseLeave={hideTip}
        onFocus={(e) => {
          // Keyboard focus only: after a click, focus stays on the
          // button and the tooltip would hide the page title.
          if (e.currentTarget.matches(":focus-visible"))
            show(m, e.currentTarget, true);
        }}
        onBlur={hideTip}
      >
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        {(labels || phone) && <span className="dock-label">{m.short}</span>}
        {badge && badge.value > 0 && (
          <span className={`badge ${badge.tone ?? ""}`}>
            {count(badge.value)}
          </span>
        )}
      </button>
    );
  };
  const moreLabel = phone ? t("Plus") : t("Plus d’outils");
  return (
    <nav
      className="dock"
      aria-label={t("Modules")}
      data-labels={labels ? "on" : "off"}
    >
      <button
        className="dock-logo"
        onClick={onLogo}
        aria-label={t("Situation")}
        title="orion aic"
      >
        <Mark size={34} />
      </button>
      <div
        className="dock-rail"
        ref={rail}
        onMouseMove={(e) => magnify(e.clientY)}
        onMouseLeave={() => {
          magnify(null);
          hideTip();
        }}
      >
        {info(bar).map((m) => item(m))}
        {/* A module opened from « Plus d’outils » shows where you are. */}
        {!phone && inMore && item(moduleInfo(current), "dock-visiting")}
        {tucked.length > 0 && (
          <button
            ref={moreRef}
            className="dock-item dock-more"
            aria-current={inMore && phone ? "page" : undefined}
            aria-label={labels || phone ? undefined : moreLabel}
            aria-haspopup={phone ? "dialog" : "menu"}
            aria-expanded={more}
            title={phone ? undefined : t("Tous les autres modules")}
            onClick={() => {
              hideTip();
              setMore((open) => !open);
            }}
          >
            <LayoutGrid size={20} strokeWidth={1.8} aria-hidden="true" />
            {(labels || phone) && (
              <span className="dock-label">{moreLabel}</span>
            )}
            {moreBadge > 0 && <span className="badge dot" />}
          </button>
        )}
        {!phone && (
          <>
            <span className="dock-sep" aria-hidden="true" />
            {item(moduleInfo("docs"))}
          </>
        )}
      </div>
      {tip && !phone && (
        <div
          ref={tipRef}
          className="dock-tip"
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.m.label}
          <small>{tip.m.description}</small>
        </div>
      )}
      {more && !phone && (
        <Popover
          anchor={moreRef.current}
          side="right"
          className="menu dock-panel"
          label={t("Plus d’outils")}
          onClose={() => setMore(false)}
        >
          <MoreList
            modules={layout.more}
            current={current}
            badges={badges}
            onGo={(m) => {
              setMore(false);
              onGo(m);
            }}
            onChoose={() => {
              setMore(false);
              onChoose();
            }}
          />
        </Popover>
      )}
      {more && phone && (
        <Sheet title={t("Tous les modules")} onClose={() => setMore(false)}>
          <MoreList
            grid
            modules={[...layout.more, "docs"]}
            first={sheetBar}
            current={current}
            badges={badges}
            onGo={(m) => {
              setMore(false);
              onGo(m);
            }}
            onChoose={() => {
              setMore(false);
              onChoose();
            }}
          />
        </Sheet>
      )}
    </nav>
  );
}

/**
 * The modules not in the dock, by group, each with the sentence saying what
 * it is for; on a phone, the modules of this post that did not fit first.
 */
function MoreList({
  modules,
  first = [],
  current,
  badges,
  grid = false,
  onGo,
  onChoose,
}: {
  modules: Module[];
  first?: Module[];
  current: Module;
  badges: Badges;
  grid?: boolean;
  onGo: (m: Module) => void;
  onChoose: () => void;
}) {
  const groups: { label: string; ids: Module[] }[] = [];
  if (first.length) groups.push({ label: t("Vos modules"), ids: first });
  for (const m of MODULES)
    if (modules.includes(m.id)) {
      const label = m.id === "docs" ? t("Aide") : groupLabel(m.group);
      const group = groups.find((g) => g.label === label && g.ids !== first);
      if (group) group.ids.push(m.id);
      else groups.push({ label, ids: [m.id] });
    }
  const entry = (id: Module): ReactNode => {
    const m = moduleInfo(id);
    const Icon = m.icon;
    const badge = badges[id];
    return (
      <button
        key={id}
        className={grid ? "dock-more-item" : "dock-panel-item"}
        aria-current={current === id ? "page" : undefined}
        data-close
        onClick={() => onGo(id)}
      >
        <Icon size={grid ? 20 : 17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          {grid ? m.short : m.label}
          {!grid && <small>{m.description}</small>}
        </span>
        {badge && badge.value > 0 && (
          <span className={`badge ${badge.tone ?? ""}`}>
            {count(badge.value)}
          </span>
        )}
      </button>
    );
  };
  return (
    <div className={grid ? "dock-more-list" : undefined}>
      {!grid && <div className="menu-label">{t("Plus d’outils")}</div>}
      {groups.map((g) => (
        <section key={g.label} className="dock-more-group">
          <h3 className="dock-more-heading">{g.label}</h3>
          <div className={grid ? "dock-more-grid" : undefined}>
            {g.ids.map(entry)}
          </div>
        </section>
      ))}
      <button className="dock-choose link" onClick={onChoose}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        {t("Choisir les modules de la barre")}
      </button>
    </div>
  );
}
