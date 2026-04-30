import { ensureServerBooted } from "@/server";
import { createSseStream, parseTopicParam, sseResponse } from "@/server/events/sse";
import { eventMatchesTopics } from "@/server/events/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureServerBooted();
  const url = new URL(request.url);
  const topics = parseTopicParam(url.searchParams.get("topics"));
  return sseResponse(
    createSseStream({
      request,
      filter: (event) =>
        event.type !== "conversation.message.created" &&
        eventMatchesTopics(event, topics),
    }),
  );
}
