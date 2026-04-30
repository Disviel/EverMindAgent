import "server-only";

import { getDbSnapshot, updateDb } from "@/server/store/db";
import type { SetupDraft } from "@/types/setup/v1beta1";

export async function getOwnerUser() {
  return (await getDbSnapshot()).user ?? null;
}

export async function commitOwnerSetup(draft: SetupDraft) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    db.user = {
      id: "current-user",
      name: draft.owner.name.trim(),
      createdAt: db.user?.createdAt ?? now,
      updatedAt: now,
    };
    db.setupDraft = draft;
    return db.user;
  });
}
