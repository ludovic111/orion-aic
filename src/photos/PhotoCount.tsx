import { Camera } from "lucide-react";
import { photosOf } from "../../shared/photos";
import type { Ops } from "../../shared/ops";
import { tn } from "./i18n.ts";
import "./photos.css";

/** Small mark in a list: this item has photos (how many). */
export function PhotoCount({
  ops,
  target,
  className = "tag dim",
}: {
  ops: Pick<Ops, "photos">;
  target: string;
  className?: string;
}) {
  const n = photosOf(ops, target).length;
  if (!n) return null;
  const label = tn(n, "{n} photo", "{n} photos");
  return (
    <span className={`${className} photo-count`} title={label}>
      <Camera size={11} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{n}</span>
    </span>
  );
}
