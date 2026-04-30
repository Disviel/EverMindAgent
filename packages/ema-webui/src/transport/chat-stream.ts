import { subscribeSse } from "@/transport/sse";
import type { EmaKnownEvent } from "@/types/events/v1beta1";

export function subscribeChatEvents({
  actorId,
  session,
  handler,
}: {
  actorId: string;
  session: string;
  handler: (event: EmaKnownEvent) => void;
}) {
  const params = new URLSearchParams({ actorId });
  return subscribeSse<EmaKnownEvent>(
    `/api/v1beta1/chat/${encodeURIComponent(session)}/stream?${params}`,
    handler,
  );
}
