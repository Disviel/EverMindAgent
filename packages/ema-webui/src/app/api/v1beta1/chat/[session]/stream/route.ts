import { ensureServerBooted } from "@/server";
import { createSseStream, sseResponse } from "@/server/events/sse";
import { eventMatchesConversation } from "@/server/events/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  ensureServerBooted();
  const { session } = await context.params;
  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId")?.trim() || undefined;
  return sseResponse(
    createSseStream({
      request,
      filter: (event) => eventMatchesConversation(event, session, actorId),
    }),
  );
}
