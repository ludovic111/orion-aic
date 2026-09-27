import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { LatLng } from "./geo";
import type { Ghost } from "./places";
import type { Info } from "./MapCards";
import type { ShapeEdit } from "./useShapeEditor";
import { DRAWING, type Tool } from "./tools";

// Keyboard of the map: undo / redo, Échap (card, tool, drawing, full
// screen), Entrée to finish a drawing, ⌫ to remove its last point.

export function useMapKeyboard({
  step,
  info,
  setInfo,
  ghostMenu,
  setGhostMenu,
  shapeEdit,
  setShapeEdit,
  draft,
  setDraft,
  measureDone,
  tool,
  chooseTool,
  finish,
  full,
  setFull,
}: {
  step: (direction: "undo" | "redo") => void;
  info: Info | null;
  setInfo: (info: Info | null) => void;
  ghostMenu: Ghost | null;
  setGhostMenu: (menu: null) => void;
  shapeEdit: ShapeEdit | null;
  setShapeEdit: (edit: null) => void;
  draft: LatLng[];
  setDraft: Dispatch<SetStateAction<LatLng[]>>;
  measureDone: boolean;
  tool: Tool;
  chooseTool: (tool: Tool) => void;
  finish: () => void;
  full: boolean;
  setFull: (full: boolean) => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      // Undo / redo of the map operations of this post (also with the
      // sheet of an object open, outside its fields).
      const undoKey =
        (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z";
      const redoKey = e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "y";
      if ((undoKey || redoKey) && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        step(redoKey || e.shiftKey ? "redo" : "undo");
        return;
      }
      if (document.querySelector(".sheet-panel, dialog[open]")) return;
      if (e.key === "Escape") {
        if (info) setInfo(null);
        else if (ghostMenu) setGhostMenu(null);
        else if (shapeEdit) setShapeEdit(null);
        else if (draft.length && !measureDone) setDraft([]);
        else if (tool !== "select") chooseTool("select");
        else return;
        e.preventDefault();
      } else if (e.key === "Enter" && DRAWING.includes(tool) && draft.length) {
        e.preventDefault();
        finish();
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        draft.length &&
        !measureDone
      ) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Escape leaves the full screen map.
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector("dialog[open], .sheet-panel")
      )
        setFull(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [full]);
}
