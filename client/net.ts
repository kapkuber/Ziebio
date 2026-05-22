import {
  decodeSnapshot,
  decodeWelcome,
  OP_SNAPSHOT,
  OP_WELCOME,
  type Snapshot,
  type Welcome,
} from "./protocol.ts";

export interface NetHandlers {
  onWelcome: (w: Welcome) => void;
  onSnapshot: (s: Snapshot) => void;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

export class Net {
  private ws: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: NetHandlers,
  ) {}

  connect(): void {
    this.handlers.onStatusChange?.("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      console.log("[net] open", this.url);
      this.handlers.onStatusChange?.("open");
    });
    ws.addEventListener("close", (e) => {
      console.log("[net] close", e.code);
      this.handlers.onStatusChange?.("closed");
    });
    ws.addEventListener("error", (e) => console.error("[net] error", e));
    ws.addEventListener("message", (ev) => {
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      const op = buf[0];
      try {
        if (op === OP_WELCOME) this.handlers.onWelcome(decodeWelcome(buf));
        else if (op === OP_SNAPSHOT) this.handlers.onSnapshot(decodeSnapshot(buf));
        else console.warn(`[net] unknown opcode 0x${op.toString(16)}`);
      } catch (err) {
        console.error("[net] decode error", err);
      }
    });

    this.ws = ws;
  }

  send(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
    }
  }
}
