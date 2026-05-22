// Minimal authoritative-server skeleton. Starting point for multiplayer
// expansion. On each WS connection sends a 25 Hz binary heartbeat (0xFF) so
// you can confirm the pipe is live; replace the heartbeat loop with a real
// fixed-tick simulation when you're ready to build the game server.
//
// Companion files designed to plug in here:
//   protocol.ts  — binary encoders (WELCOME, SNAPSHOT) + INPUT decoder
//   world.ts     — Entity/Bullet/DeathFx/World/Client type scaffolding
//   quadtree.ts  — broadphase spatial index
//   rng.ts       — deterministic xorshift32 RNG
//   math.ts      — vec2 helpers

import uWS from "uWebSockets.js";

const PORT = 8080;
const TICK_HZ = 25;
const TICK_MS = 1000 / TICK_HZ;

const clients = new Set<uWS.WebSocket<unknown>>();
const HEARTBEAT = new Uint8Array([0xff]);

const app = uWS.App();

app.ws("/*", {
  compression: uWS.DISABLED,
  maxPayloadLength: 16 * 1024,
  idleTimeout: 60,
  open: (ws) => {
    clients.add(ws);
    console.log(`[ws] open  -> clients=${clients.size}`);
  },
  close: (ws, code) => {
    clients.delete(ws);
    console.log(`[ws] close code=${code} -> clients=${clients.size}`);
  },
});

app.listen(PORT, (listenSocket) => {
  if (listenSocket) {
    console.log(`[srv] listening on :${PORT} (heartbeat ${TICK_MS}ms)`);
  } else {
    console.error(`[srv] failed to bind :${PORT}`);
    process.exit(1);
  }
});

setInterval(() => {
  for (const ws of clients) ws.send(HEARTBEAT, true);
}, TICK_MS);

process.on("SIGINT", () => {
  console.log("[srv] SIGINT received, shutting down");
  process.exit(0);
});
