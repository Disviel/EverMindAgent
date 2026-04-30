import type { OwnerStatusResponse } from "@/types/auth/v1beta1";

export async function getOwnerStatus() {
  const response = await fetch("/api/v1beta1/auth/owner-status", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as OwnerStatusResponse;
}
