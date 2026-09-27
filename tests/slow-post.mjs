import { connect } from "node:net";
import { randomBytes } from "node:crypto";

// A post that reads from the relay at a chosen rate (a phone on a slow
// link), or not at all: a raw WebSocket client over TCP whose socket is
// paused and resumed to keep to `rate` bytes per second. Used by
// tests/relay.test.mjs and tests/sync-relay.test.mjs.

const masked = (opcode, payload) => {
  const mask = randomBytes(4);
  const body = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | length])
      : Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 255]);
  return Buffer.concat([head, mask, body]);
};

/**
 * Joins `room` on the relay at `url` and reads at `rate` bytes/s (0: never
 * reads after the welcome). `onFrame(bytes)`: each binary frame received.
 */
export async function slowPost(url, room, { rate = 0, onFrame } = {}) {
  const { hostname, port } = new URL(url);
  const socket = connect(Number(port), hostname);
  await new Promise((r) => socket.once("connect", r));
  socket.write(
    "GET /sync HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let id = "";
  let welcome;
  let refuse;
  const welcomed = new Promise((resolve, reject) => {
    welcome = resolve;
    refuse = reject;
  });
  const state = { bytes: 0, frames: 0, closeCode: 0, closedAt: 0 };
  const closed = new Promise((resolve) =>
    socket.once("close", () => {
      state.closedAt = Date.now();
      resolve(state.closeCode || 1006);
    }),
  );
  socket.on("error", () => {});
  const started = Date.now();
  let reading = true;
  const parse = () => {
    for (;;) {
      if (buffer.length < 2) return;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const opcode = buffer[0] & 0x0f;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode === 1) {
        const value = JSON.parse(payload.toString());
        if (value.t === "welcome") {
          id = value.id;
          welcome(value);
        } else if (value.t === "error")
          refuse(new Error(`relay refused: ${value.code}`));
      } else if (opcode === 2) {
        state.frames++;
        onFrame?.(new Uint8Array(payload));
      } else if (opcode === 9) socket.write(masked(10, payload));
      else if (opcode === 8) state.closeCode = payload.readUInt16BE(0);
    }
  };
  socket.on("data", (chunk) => {
    if (!upgraded) {
      const text = chunk.toString("latin1");
      const end = text.indexOf("\r\n\r\n");
      if (end < 0) return;
      upgraded = true;
      chunk = chunk.subarray(end + 4);
    }
    state.bytes += chunk.length;
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    parse();
    // Keep to the rate: pause until the bytes read are due.
    if (reading && rate) {
      const due = started + (state.bytes / rate) * 1000;
      const wait = due - Date.now();
      if (wait > 1) {
        socket.pause();
        setTimeout(() => reading && socket.resume(), wait);
      }
    }
  });
  await new Promise((r) => setTimeout(r, 20));
  socket.write(
    masked(1, Buffer.from(JSON.stringify({ t: "join", room, v: 2 }))),
  );
  await welcomed;
  if (!rate) socket.pause();
  return {
    id: () => id,
    state,
    closed,
    destroy() {
      reading = false;
      socket.destroy();
    },
  };
}
