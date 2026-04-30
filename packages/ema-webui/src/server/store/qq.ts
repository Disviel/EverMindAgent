import "server-only";

import { getDbSnapshot, updateDb } from "@/server/store/db";
import type {
  ActorQQConnectionStatus,
  ActorQQConnectionStatusResponse,
} from "@/types/dashboard/v1beta1";

export async function getQqConnection(actorId: string) {
  return (await getDbSnapshot()).qqConnections[actorId] ?? null;
}

export async function setQqConnection({
  actorId,
  status,
  endpoint,
  enabled,
}: {
  actorId: string;
  status: ActorQQConnectionStatus;
  endpoint: string;
  enabled: boolean;
}) {
  const checkedAt = new Date().toISOString();
  return updateDb((db) => {
    const connection = {
      actorId,
      status,
      endpoint,
      enabled,
      checkedAt,
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
      status: connection.status,
      reason,
      endpoint: connection.endpoint,
      enabled: connection.enabled,
      checkedAt: connection.checkedAt,
      retryable: connection.status === "failed",
      diagnostics: {},
    },
  };
}
