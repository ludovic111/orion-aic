// Where a photo was taken, when the camera wrote it in the file (EXIF GPS of
// a JPEG). Read once, on the post that adds the photo, to offer « Placer sur
// la carte »; never stored: the photo kept is re-encoded without metadata.

export type Position = { lat: number; lng: number };

/** Position recorded in a JPEG (its first bytes suffice), or null. */
export function jpegPosition(bytes: Uint8Array): Position | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    if (view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      const size = view.getUint16(offset + 2);
      if (
        marker === 0xffe1 &&
        view.getUint32(offset + 4) === 0x45786966 && // "Exif"
        view.getUint16(offset + 8) === 0
      )
        return readTiff(view, offset + 10);
      offset += 2 + size;
    }
  } catch {
    // Truncated or damaged file: no position.
  }
  return null;
}

function readTiff(view: DataView, start: number): Position | null {
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => view.getUint16(start + at, little);
  const u32 = (at: number) => view.getUint32(start + at, little);
  if (u16(2) !== 42) return null;
  /** Entries of a directory, by tag: offset of the entry. */
  const entries = (ifd: number) => {
    const out = new Map<number, number>();
    const count = u16(ifd);
    for (let i = 0; i < count && i < 500; i++) {
      const entry = ifd + 2 + i * 12;
      out.set(u16(entry), entry);
    }
    return out;
  };
  const gpsEntry = entries(u32(4)).get(0x8825);
  if (gpsEntry === undefined) return null;
  const gps = entries(u32(gpsEntry + 8));
  const ref = (tag: number) => {
    const entry = gps.get(tag);
    return entry === undefined
      ? ""
      : String.fromCharCode(view.getUint8(start + entry + 8));
  };
  const degrees = (tag: number) => {
    const entry = gps.get(tag);
    // Three RATIONAL values: degrees, minutes, seconds.
    if (entry === undefined || u16(entry + 2) !== 5 || u32(entry + 4) !== 3)
      return NaN;
    const at = u32(entry + 8);
    const part = (i: number) => {
      const d = u32(at + i * 8 + 4);
      return d ? u32(at + i * 8) / d : NaN;
    };
    return part(0) + part(1) / 60 + part(2) / 3600;
  };
  const lat = degrees(2) * (ref(1) === "S" ? -1 : 1);
  const lng = degrees(4) * (ref(3) === "W" ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 0, 0: a camera without a fix.
  if (lat === 0 && lng === 0) return null;
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  };
}
