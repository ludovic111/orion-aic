import { useCallback, useRef, useState } from "react";
import type { Ops } from "../../../shared/ops";
import type { AppContext } from "../../app/context";
import { applyChange, diffOps, mergeChange, type Change } from "./undo";
import { t, tn } from "./i18n.ts";

// Undo / redo of the map operations of this post, this session (the
// changes themselves: undo.ts).

export function useMapHistory({
  live,
  updateOps: updateOpsRaw,
  toast,
  readOnly,
}: Pick<AppContext, "live" | "updateOps" | "toast" | "readOnly">) {
  const liveOps = useRef(live.ops);
  liveOps.current = live.ops;
  const history = useRef<{ undo: Change[]; redo: Change[] }>({
    undo: [],
    redo: [],
  });
  const [, setHistoryTick] = useState(0);
  // Every change of the map module (sheet, dialogs included) goes through
  // here: the state of each object before and after is remembered.
  const updateOps = useCallback(
    (change: (ops: Ops) => Ops) => {
      const before = liveOps.current;
      let items: Change["items"] = [];
      try {
        items = diffOps(before, change(before));
      } catch {
        // The store reports the error below.
      }
      updateOpsRaw(change);
      if (!items.length) return;
      const h = history.current;
      const next: Change = { at: Date.now(), items };
      const merged = mergeChange(h.undo[h.undo.length - 1], next);
      if (merged) h.undo[h.undo.length - 1] = merged;
      else h.undo = [...h.undo, next].slice(-100);
      h.redo = [];
      setHistoryTick((t) => t + 1);
    },
    [updateOpsRaw],
  );
  const step = useCallback(
    (direction: "undo" | "redo") => {
      const h = history.current;
      const from = direction === "undo" ? h.undo : h.redo;
      const change = from[from.length - 1];
      if (!change) return;
      if (readOnlyRef.current)
        return toast(
          t("Lecture seule : vous consultez le passé ou un journal clôturé."),
        );
      const now = new Date().toISOString();
      let result: ReturnType<typeof applyChange> | null = null;
      try {
        updateOpsRaw((ops) => {
          result = applyChange(ops, change, direction, now);
          return result.ops;
        });
      } catch (err) {
        return toast((err as Error).message);
      }
      const done = result as ReturnType<typeof applyChange> | null;
      if (!done) return;
      from.pop();
      (direction === "undo" ? h.redo : h.undo).push(done.change);
      setHistoryTick((t) => t + 1);
      if (done.conflicts)
        toast(
          done.applied
            ? tn(
                done.conflicts,
                "{n} objet modifié depuis par un autre poste : laissé tel quel.",
                "{n} objets modifiés depuis par un autre poste : laissés tels quels.",
              )
            : t(
                "Rien à annuler : l’objet a été modifié depuis par un autre poste.",
              ),
        );
    },
    [updateOpsRaw, toast],
  );
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const canUndo = history.current.undo.length > 0 && !readOnly;
  const canRedo = history.current.redo.length > 0 && !readOnly;
  return { updateOps, step, canUndo, canRedo };
}
