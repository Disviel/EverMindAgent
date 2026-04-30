import { ensureServerBooted } from "@/server";
import { getOwnerStatus } from "@/server/services/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureServerBooted();
  return Response.json(await getOwnerStatus(), { status: 200 });
}
