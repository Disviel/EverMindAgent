import { ensureServerBooted } from "@/server";
import { createSseStream, sseResponse } from "@/server/events/sse";
import { eventMatchesConversation } from "@/server/events/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  ensureServerBooted();
  const { actorId, session } = await context.params;
  return sseResponse(
    createSseStream({
      request,
      filter: (event) => eventMatchesConversation(event, session, actorId),
    }),
  );
}
