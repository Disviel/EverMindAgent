import "server-only";

import { startActorHeartbeat } from "@/server/behaviors/actor-heartbeat";

type ServerGlobal = {
  booted: boolean;
};

const serverGlobal = globalThis as typeof globalThis & {
  __emaWebuiServer?: ServerGlobal;
};

export function ensureServerBooted() {
  serverGlobal.__emaWebuiServer ??= { booted: false };
  if (serverGlobal.__emaWebuiServer.booted) {
    return;
  }

  startActorHeartbeat();
  serverGlobal.__emaWebuiServer.booted = true;
}
