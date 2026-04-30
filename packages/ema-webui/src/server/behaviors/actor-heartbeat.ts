import "server-only";

import { createEvent, publishEvent } from "@/server/events/bus";
import { listActorRecords } from "@/server/store/actors";
import {
  createConversationMessage,
  previewFromContents,
} from "@/server/store/messages";

const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_SESSION = "web-chat-current-user";
const HEARTBEATS = [
  "我还在这里，随时可以继续。",
  "刚刚整理了一点上下文。",
  "如果你回来，我们可以接着往下走。",
];

type HeartbeatGlobal = {
  timer: ReturnType<typeof setInterval> | null;
};

const heartbeatGlobal = globalThis as typeof globalThis & {
  __emaWebuiHeartbeat?: HeartbeatGlobal;
};

export function startActorHeartbeat() {
  heartbeatGlobal.__emaWebuiHeartbeat ??= { timer: null };
  if (heartbeatGlobal.__emaWebuiHeartbeat.timer) {
    return;
  }

  heartbeatGlobal.__emaWebuiHeartbeat.timer = setInterval(() => {
    void tickActorHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

async function tickActorHeartbeat() {
  const actors = await listActorRecords();
  const activeActors = actors.filter((actor) => actor.status === "online");
  if (activeActors.length === 0) {
    return;
  }

  const actor = activeActors[Math.floor(Math.random() * activeActors.length)];
  if (!actor) {
    return;
  }

  const message = await createConversationMessage({
    actorId: actor.id,
    session: HEARTBEAT_SESSION,
    kind: "actor",
    name: actor.name,
    contents: [
      {
        type: "text",
        text: HEARTBEATS[Math.floor(Math.random() * HEARTBEATS.length)] ?? HEARTBEATS[0],
      },
    ],
  });

  publishEvent(
    createEvent({
      type: "conversation.message.created",
      actorId: actor.id,
      conversationId: HEARTBEAT_SESSION,
      data: { message },
    }),
  );
  publishEvent(
    createEvent({
      type: "actor.latest_preview",
      actorId: actor.id,
      data: {
        text: previewFromContents(message.contents),
        time: message.time ?? Date.now(),
      },
    }),
  );
}
