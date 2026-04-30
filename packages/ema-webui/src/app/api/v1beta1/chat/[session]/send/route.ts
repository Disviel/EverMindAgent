import { ensureServerBooted } from "@/server";
import { sendConversationMessage } from "@/server/services/chat";
import { getOwnerUser } from "@/server/store/users";
import type { SendMessageRequest } from "@/types/chat/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  ensureServerBooted();
  const { session } = await context.params;
  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId")?.trim() ?? "";
  if (!actorId) {
    return Response.json({ message: "Invalid actorId." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as SendMessageRequest;
  const owner = await getOwnerUser();
  const result = await sendConversationMessage({
    actorId,
    session,
    userName: owner?.name ?? "你",
    request: body,
  });
  return Response.json(result, { status: 200 });
}
