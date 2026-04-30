import "server-only";

import { getOwnerUser } from "@/server/store/users";
import type { OwnerStatusResponse } from "@/types/auth/v1beta1";

export async function getOwnerStatus(): Promise<OwnerStatusResponse> {
  const user = await getOwnerUser();
  return {
    apiVersion: "v1beta1",
    ownerReady: Boolean(user),
    ...(user
      ? {
          user: {
            id: user.id,
            name: user.name,
          },
        }
      : {}),
  };
}
