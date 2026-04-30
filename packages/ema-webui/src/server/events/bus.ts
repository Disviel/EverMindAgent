import "server-only";

import { EventEmitter } from "node:events";
import type { EmaKnownEvent } from "@/types/events/v1beta1";

type EventGlobal = {
  emitter: EventEmitter;
};

const globalEvents = globalThis as typeof globalThis & {
  __emaWebuiEvents?: EventGlobal;
};

function getEventGlobal() {
  globalEvents.__emaWebuiEvents ??= {
    emitter: new EventEmitter(),
  };
  globalEvents.__emaWebuiEvents.emitter.setMaxListeners(0);
  return globalEvents.__emaWebuiEvents;
}

export function getEventBus() {
  return getEventGlobal().emitter;
}

export function publishEvent(event: EmaKnownEvent) {
  getEventBus().emit("event", event);
}

export function createEvent<T extends EmaKnownEvent>(
  event: Omit<T, "ts"> & { ts?: number },
): T {
  return {
    ...event,
    ts: event.ts ?? Date.now(),
  } as T;
}
