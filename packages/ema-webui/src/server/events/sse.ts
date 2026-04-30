import "server-only";

import { getEventBus } from "@/server/events/bus";
import type { EmaKnownEvent, EmaEventTopic } from "@/types/events/v1beta1";

const KEEPALIVE_INTERVAL_MS = 15000;

function encodeSse(event: EmaKnownEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createSseStream({
  request,
  filter,
}: {
  request: Request;
  filter: (event: EmaKnownEvent) => boolean;
}) {
  const encoder = new TextEncoder();
  const bus = getEventBus();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (event: EmaKnownEvent) => {
        if (filter(event)) {
          send(encodeSse(event));
        }
      };
      const keepalive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, KEEPALIVE_INTERVAL_MS);
      const cleanup = () => {
        clearInterval(keepalive);
        bus.off("event", onEvent);
      };

      bus.on("event", onEvent);
      send(`: connected ${Date.now()}\n\n`);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });
}

export function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function parseTopicParam(value: string | null): EmaEventTopic[] | null {
  if (!value) {
    return null;
  }
  return value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean) as EmaEventTopic[];
}
