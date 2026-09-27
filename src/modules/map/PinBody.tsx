import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Place } from "../../../shared/ops";
import { formatNumber } from "../../../shared/i18n/core.ts";
import { t } from "./i18n.ts";
import { clampSize, normalizeAngle } from "./PlaceSheet";
import { Glyph } from "./symbols";
import { hexColor } from "./maps";

// Symbols and texts on the map: React content rendered through a portal
// into the element of each Leaflet marker, with the handles of the object
// selected.

export type Style = Pick<Place, "size" | "rotation">;

/**
 * Direct manipulation of a selected symbol or text: drag the corner to
 * resize, the knob to rotate. Native listeners, so that neither the marker
 * nor the map starts dragging (pointer events work with mouse and touch).
 */
function Handles({
  value,
  onPreview,
  onCommit,
}: {
  value: Style;
  onPreview: (v: Style | null) => void;
  onCommit: (v: Style) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onPreview, onCommit });
  latest.current = { value, onPreview, onCommit };
  useEffect(() => {
    const root = ref.current;
    const host = root?.parentElement;
    if (!root || !host) return;
    const stop = (e: Event) => e.stopPropagation();
    const blocked = ["mousedown", "touchstart", "click", "dblclick"];
    const knobs = [...root.querySelectorAll<HTMLElement>("[data-handle]")];
    const offs: (() => void)[] = [];
    for (const knob of knobs) {
      const mode = knob.dataset.handle;
      const down = (e: PointerEvent) => {
        if (e.button > 0) return;
        e.stopPropagation();
        e.preventDefault();
        const box = host.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const start = latest.current.value;
        const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy));
        const a0 = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
        let last: Style | null = null;
        knob.setPointerCapture?.(e.pointerId);
        root.classList.add("active");
        const move = (ev: PointerEvent) => {
          ev.stopPropagation();
          const dx = ev.clientX - cx;
          const dy = ev.clientY - cy;
          if (mode === "size") {
            const k = Math.hypot(dx, dy) / d0;
            last = {
              ...start,
              size: clampSize(Math.round(start.size * k * 20) / 20),
            };
          } else {
            let deg =
              start.rotation + (Math.atan2(dy, dx) * 180) / Math.PI - a0;
            // Snap to 15° steps when close: straight lines are easy.
            const snap = Math.round(deg / 15) * 15;
            if (Math.abs(deg - snap) < 4 || ev.shiftKey) deg = snap;
            last = { ...start, rotation: normalizeAngle(deg) };
          }
          latest.current.onPreview(last);
        };
        const up = (ev: PointerEvent) => {
          ev.stopPropagation();
          knob.removeEventListener("pointermove", move);
          knob.removeEventListener("pointerup", up);
          knob.removeEventListener("pointercancel", up);
          root.classList.remove("active");
          if (last && ev.type === "pointerup") latest.current.onCommit(last);
          else latest.current.onPreview(null);
        };
        knob.addEventListener("pointermove", move);
        knob.addEventListener("pointerup", up);
        knob.addEventListener("pointercancel", up);
      };
      // Keyboard: arrows turn by 15° or resize by a tenth.
      const key = (e: KeyboardEvent) => {
        const v = latest.current.value;
        const up = e.key === "ArrowUp" || e.key === "ArrowRight";
        const downKey = e.key === "ArrowDown" || e.key === "ArrowLeft";
        if (!up && !downKey) return;
        e.preventDefault();
        e.stopPropagation();
        latest.current.onCommit(
          mode === "size"
            ? { ...v, size: clampSize(v.size + (up ? 0.1 : -0.1)) }
            : { ...v, rotation: normalizeAngle(v.rotation + (up ? 15 : -15)) },
        );
      };
      knob.addEventListener("pointerdown", down);
      knob.addEventListener("keydown", key);
      blocked.forEach((t) => knob.addEventListener(t, stop));
      offs.push(() => {
        knob.removeEventListener("pointerdown", down);
        knob.removeEventListener("keydown", key);
        blocked.forEach((t) => knob.removeEventListener(t, stop));
      });
    }
    return () => offs.forEach((off) => off());
  }, []);
  return (
    <div ref={ref} className="map-handles">
      <span
        data-handle="rotate"
        className="map-handle rotate"
        role="slider"
        tabIndex={0}
        aria-label={t("Rotation : glisser, ou flèches pour tourner de 15°")}
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={value.rotation}
        aria-valuetext={`${value.rotation}°`}
        title={t("Glisser pour tourner (flèches : 15°)")}
      />
      <span
        data-handle="size"
        className="map-handle size"
        role="slider"
        tabIndex={0}
        aria-label={t("Taille : glisser, ou flèches pour agrandir ou réduire")}
        aria-valuemin={0.25}
        aria-valuemax={8}
        aria-valuenow={value.size}
        aria-valuetext={`×${value.size}`}
        title={t("Glisser pour agrandir ou réduire (flèches : ±{step})", {
          step: formatNumber(0.1),
        })}
      />
    </div>
  );
}

/** Content of a point or text marker, rendered into Leaflet's icon element. */
export const PinBody = memo(function PinBody({
  place,
  hot,
  links,
  editable,
  onStyle,
}: {
  place: Place;
  hot: boolean;
  links: number;
  /** Selected and editable: resize and rotate handles. */
  editable: boolean;
  onStyle: (id: string, style: Style) => void;
}) {
  const [draft, setDraft] = useState<Style | null>(null);
  // A saved change (or a change from another post) replaces the preview.
  useEffect(() => setDraft(null), [place.updatedAt]);
  const size = draft?.size ?? place.size;
  const color = hexColor(place.color);
  const rotation = draft?.rotation ?? place.rotation;
  const handles = editable && (
    <Handles
      value={{ size, rotation }}
      onPreview={setDraft}
      onCommit={(v) => {
        setDraft(v);
        onStyle(place.id, v);
      }}
    />
  );
  if (place.kind === "text")
    return (
      <div
        className={`map-text${place.boxed ? " boxed" : ""}${hot ? " hot" : ""}${editable ? " editing" : ""}`}
        style={
          {
            ...(color ? { "--c": color } : {}),
            "--rot": `${rotation}deg`,
            fontSize: `${15 * size}px`,
            maxWidth: `${Math.round(280 * Math.max(1, size))}px`,
          } as CSSProperties
        }
      >
        {place.label || t("Texte")}
        {handles}
      </div>
    );
  const box = Math.round(34 * size);
  return (
    <div
      className={`map-pin${hot ? " hot" : ""}${place.frame ? " framed" : ""}${editable ? " editing" : ""}`}
      style={
        {
          "--box": `${box}px`,
          ...(color ? { "--ring": color } : {}),
        } as CSSProperties
      }
    >
      <div
        className="map-pin-symbol"
        style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
      >
        <Glyph
          symbol={place.symbol}
          color={color}
          size={box}
          frame={place.frame}
        />
        {handles}
      </div>
      {links > 0 && <span className="map-pin-badge">{links}</span>}
      {place.label && (
        <span
          className="map-pin-label"
          style={
            size > 1.2
              ? { fontSize: `${11.5 * Math.min(2, size * 0.85)}px` }
              : undefined
          }
        >
          {place.label}
        </span>
      )}
    </div>
  );
});
