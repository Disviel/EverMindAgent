import "server-only";

import { createEvent, publishEvent } from "@/server/events/bus";
import {
  getActorRecord,
  updateActorRuntimeStatus,
} from "@/server/store/actors";
import type { ActorRuntimeStatus } from "@/types/dashboard/v1beta1";

function delay(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function pickEnabledStatus(): ActorRuntimeStatus {
  const roll = Math.random();
  if (roll < 0.25) return "sleeping";
  if (roll < 0.85) return "online";
  return "busy";
}

export async function switchActorEnabled(actorId: string, enabled: boolean) {
  const actor = await getActorRecord(actorId);
  if (!actor) {
    return null;
  }

  await updateActorRuntimeStatus(actorId, "preparing", true);
  publishEvent(
    createEvent({
      type: "actor.runtime.changed",
      actorId,
      data: { status: "preparing" },
    }),
  );

  await delay(enabled ? 1800 : 420);
  const nextStatus = enabled ? pickEnabledStatus() : "offline";
  const summary = await updateActorRuntimeStatus(
    actorId,
    nextStatus,
    nextStatus !== "offline",
  );
  publishEvent(
    createEvent({
      type: "actor.runtime.changed",
      actorId,
      data: { status: nextStatus },
    }),
  );
  if (summary) {
    publishEvent(
      createEvent({
        type: "actor.updated",
        actorId,
        data: { actor: summary },
      }),
    );
  }

  return summary;
}
