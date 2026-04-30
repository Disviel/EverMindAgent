import { ensureServerBooted } from "@/server";
import { buildDashboardOverview } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureServerBooted();
  const overview = await buildDashboardOverview();
  return Response.json(overview, { status: 200 });
}
