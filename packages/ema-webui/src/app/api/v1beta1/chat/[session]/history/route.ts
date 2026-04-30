import { buildChatHistory } from "@/server/services/chat";
import { ensureServerBooted } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  ensureServerBooted();
  const { session } = await context.params;
  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId")?.trim() ?? "";
  const limit = parseOptionalInteger(url.searchParams.get("limit"));
  const beforeMsgId = parseOptionalInteger(url.searchParams.get("beforeMsgId"));

  if (!actorId) {
    return Response.json(
      {
        message: "Invalid actorId.",
      },
      { status: 400 },
    );
  }

  const history = await buildChatHistory({
    actorId,
    session,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof beforeMsgId === "number" ? { beforeMsgId } : {}),
  });

  return Response.json(history, { status: 200 });
}

function parseOptionalInteger(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}
