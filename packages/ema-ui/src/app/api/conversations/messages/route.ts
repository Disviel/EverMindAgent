/**
 * Conversation messages endpoint.
 */

import { getServer } from "../../shared-server";
import type { Message } from "ema";

export async function GET(request: Request) {
  const server = await getServer();
  const url = new URL(request.url);
  const rawConversationId = url.searchParams.get("conversationId");
  const rawLimit = url.searchParams.get("limit");

  if (!rawConversationId) {
    return new Response(
      JSON.stringify({ error: "conversationId is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const conversationId = Number.parseInt(rawConversationId, 10);
  if (Number.isNaN(conversationId)) {
    return new Response(
      JSON.stringify({ error: "conversationId must be a number" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed)) {
      return new Response(JSON.stringify({ error: "limit must be a number" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    limit = parsed;
  }

  const rows = await server.conversationMessageDB.listConversationMessages({
    conversationId,
    limit,
    sort: "desc",
  });

  const messages: Message[] = rows.reverse().map((row) => {
    const msg = row.message;
    if (msg.kind === "user") {
      return { role: "user", contents: msg.contents };
    }
    return { role: "model", contents: msg.contents };
  });

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
