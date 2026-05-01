import { ensureServerBooted } from "@/server";
import {
  buildActorQqChannelResponse,
  saveActorQqServiceConfig,
} from "@/server/services/dashboard";
import type { ActorQQSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  return Response.json(await buildActorQqChannelResponse(actorId), {
    status: 200,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  ensureServerBooted();
  const { actorId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as ActorQQSaveRequest;
  const result = await saveActorQqServiceConfig(actorId, body);
  return Response.json(result, { status: 200 });
}
