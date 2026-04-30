import { buildDashboardOverview } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await buildDashboardOverview();
  return Response.json(overview, { status: 200 });
}
