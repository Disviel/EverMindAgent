import { ensureServerBooted } from "@/server";
import { saveActorQqServiceConfig } from "@/server/services/dashboard";
import type { ActorQQSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  ensureServerBooted();
  const { actorId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as ActorQQSaveRequest;
  const result = await saveActorQqServiceConfig(actorId, body);
  return Response.json(result, { status: 200 });
}
