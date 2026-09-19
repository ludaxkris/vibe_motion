// An OS-assigned TCP port that was free a moment ago.
//
// No host argument: `next dev` binds the wildcard (dual-stack `::`), so the probe must too, or a
// listener on [::1]:<port> alone would pass the probe and then collide. The gap between closing
// the probe and the dev server binding is real but harmless: the kernel walks the ephemeral range
// instead of handing the same port straight back, and a collision fails loudly (an explicit
// `--port` makes Next skip its EADDRINUSE retry), never silently.
import { createServer } from "node:net";

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
