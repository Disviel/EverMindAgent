import "server-only";

import { createEvent, publishEvent } from "@/server/events/bus";
import { setQqConnection } from "@/server/store/qq";
import type {
  ActorQQConfig,
  ActorQQConnectionStatus,
  ActorQQConnectionSyncReason,
} from "@/types/dashboard/v1beta1";

function deriveStatus(
  config: ActorQQConfig,
  reason: ActorQQConnectionSyncReason,
): ActorQQConnectionStatus {
  if (!config.enabled) return "disabled";
  if (!config.wsUrl.trim() || !config.accessToken.trim()) return "unconfigured";
  if (reason === "poll") return Math.random() < 0.9 ? "connected" : "failed";
  if (reason === "retry") return Math.random() < 0.68 ? "connected" : "failed";
  return Math.random() < 0.72 ? "connected" : "failed";
}

export async function syncQqConnection({
  actorId,
  config,
  reason,
}: {
  actorId: string;
  config: ActorQQConfig;
  reason: ActorQQConnectionSyncReason;
}) {
  const status = deriveStatus(config, reason);
  const connection = await setQqConnection({
    actorId,
    status,
    endpoint: config.wsUrl.trim(),
    enabled: config.enabled,
  });

  publishEvent(
    createEvent({
      type: "channel.qq.connection.changed",
      actorId,
      data: {
        status: connection.status,
        endpoint: connection.endpoint,
        enabled: connection.enabled,
        checkedAt: connection.checkedAt,
      },
    }),
  );

  return connection;
}
