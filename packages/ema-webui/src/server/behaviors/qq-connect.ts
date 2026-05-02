import "server-only";

import { createEvent, publishEvent } from "@/server/events/bus";
import { setQqConnection } from "@/server/store/qq";
import type {
  ActorQQConfig,
  ActorQQConnectionSyncReason,
  ActorQQTransportStatus,
} from "@/types/dashboard/v1beta1";

function deriveStatus(
  config: ActorQQConfig,
  reason: ActorQQConnectionSyncReason,
): ActorQQTransportStatus {
  if (!config.enabled || !config.wsUrl.trim() || !config.accessToken.trim()) {
    return "disconnected";
  }
  if (reason === "poll") {
    return Math.random() < 0.9 ? "connected" : "disconnected";
  }
  if (reason === "retry") {
    return Math.random() < 0.68 ? "connected" : "disconnected";
  }
  return Math.random() < 0.72 ? "connected" : "disconnected";
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
    transportStatus: status,
    blockedBy: config.enabled ? null : "qq_disabled",
    endpoint: config.wsUrl.trim(),
    enabled: config.enabled,
    retryable: config.enabled && status === "disconnected",
  });

  publishEvent(
    createEvent({
      type: "channel.qq.connection.changed",
      actorId,
      data: {
        transportStatus: connection.transportStatus,
        blockedBy: connection.blockedBy,
        endpoint: connection.endpoint,
        enabled: connection.enabled,
        checkedAt: connection.checkedAt,
        retryable: connection.retryable,
      },
    }),
  );

  return connection;
}
