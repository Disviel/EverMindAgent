import "server-only";

import { getDbSnapshot, updateDb } from "@/server/store/db";
import type {
  ActorQQBlockedBy,
  ActorQQConnectionStatusResponse,
  ActorQQTransportStatus,
} from "@/types/dashboard/v1beta1";

export async function getQqConnection(actorId: string) {
  return (await getDbSnapshot()).qqConnections[actorId] ?? null;
}

export async function setQqConnection({
  actorId,
  transportStatus,
  blockedBy,
  endpoint,
  enabled,
  retryable,
}: {
  actorId: string;
  transportStatus: ActorQQTransportStatus;
  blockedBy: ActorQQBlockedBy;
  endpoint: string;
  enabled: boolean;
  retryable: boolean;
}) {
  const checkedAt = new Date().toISOString();
  return updateDb((db) => {
    const connection = {
      actorId,
      transportStatus,
      blockedBy,
      endpoint,
      enabled,
      checkedAt,
      retryable,
    };
    db.qqConnections[actorId] = connection;
    return connection;
  });
}

export function qqConnectionResponse(
  actorId: string,
  connection: Awaited<ReturnType<typeof setQqConnection>>,
  reason: ActorQQConnectionStatusResponse["connection"]["reason"],
): ActorQQConnectionStatusResponse {
  return {
    apiVersion: "v1beta1",
    ok: true,
    connection: {
      id: `qq-connection-${actorId}`,
      target: "qq",
      actorId,
      transportStatus: connection.transportStatus,
      blockedBy: connection.blockedBy,
      reason,
      endpoint: connection.endpoint,
      enabled: connection.enabled,
      checkedAt: connection.checkedAt,
      retryable: connection.retryable,
      diagnostics: {},
    },
  };
}
