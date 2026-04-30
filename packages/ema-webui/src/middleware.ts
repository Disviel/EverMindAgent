import { NextResponse, type NextRequest } from "next/server";
import type { OwnerStatusResponse } from "@/types/auth/v1beta1";

export const config = {
  matcher: ["/((?!_next/|api/|mock/|.*\\..*).*)"],
};

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ownerReady = await getOwnerReady(request);

  if (!ownerReady && pathname !== "/setup") {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  if (ownerReady && (pathname === "/" || pathname === "/setup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

async function getOwnerReady(request: NextRequest) {
  try {
    const response = await fetch(
      new URL("/api/v1beta1/auth/owner-status", request.url),
      { cache: "no-store" },
    );
    if (!response.ok) {
      return false;
    }
    const status = (await response.json()) as OwnerStatusResponse;
    return status.ownerReady;
  } catch {
    return false;
  }
}
