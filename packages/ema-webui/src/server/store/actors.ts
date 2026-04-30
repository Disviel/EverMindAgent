import "server-only";

import { randomUUID } from "node:crypto";
import { getDbSnapshot, updateDb } from "@/server/store/db";
import {
  DEFAULT_QQ_CONFIG,
  toActorSummary,
  type MockActorRecord,
} from "@/server/store/schema";
import type {
  ActorLlmConfig,
  ActorRuntimeStatus,
  ActorSummary,
  ActorWebSearchConfig,
  CreateActorRequest,
} from "@/types/dashboard/v1beta1";

export async function listActorRecords() {
  return (await getDbSnapshot()).actors;
}

export async function listActorSummaries(): Promise<ActorSummary[]> {
  return (await listActorRecords()).map(toActorSummary);
}

export async function getActorRecord(actorId: string) {
  return (await getDbSnapshot()).actors.find((actor) => actor.id === actorId) ?? null;
}

export async function createActorRecord(
  request: CreateActorRequest,
): Promise<ActorSummary> {
  const now = new Date().toISOString();
  return updateDb((db) => {
    const actor: MockActorRecord = {
      id: `actor-${randomUUID().slice(0, 8)}`,
      name: request.name.trim(),
      avatarUrl: request.avatarUrl,
      roleBook: request.roleBook,
      sleepSchedule: { ...request.sleepSchedule },
      enabled: false,
      status: "offline",
      createdAt: now,
      updatedAt: now,
      settings: {
        qq: { ...DEFAULT_QQ_CONFIG, conversations: [] },
      },
    };
    db.actors.push(actor);
    return toActorSummary(actor);
  });
}

export async function updateActorRuntimeStatus(
  actorId: string,
  status: ActorRuntimeStatus,
  enabled = status !== "offline",
) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    const actor = db.actors.find((item) => item.id === actorId);
    if (!actor) {
      return null;
    }
    actor.status = status;
    actor.enabled = enabled;
    actor.updatedAt = now;
    return toActorSummary(actor);
  });
}

export async function saveActorLlmSettings(actorId: string, config: ActorLlmConfig) {
  return updateDb((db) => {
    const actor = db.actors.find((item) => item.id === actorId);
    if (!actor) {
      return false;
    }
    actor.settings.llm = config;
    actor.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function saveActorWebSearchSettings(
  actorId: string,
  config: ActorWebSearchConfig,
) {
  return updateDb((db) => {
    const actor = db.actors.find((item) => item.id === actorId);
    if (!actor) {
      return false;
    }
    actor.settings.webSearch = config;
    actor.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function saveActorQqSettings(
  actorId: string,
  config: MockActorRecord["settings"]["qq"],
) {
  return updateDb((db) => {
    const actor = db.actors.find((item) => item.id === actorId);
    if (!actor) {
      return false;
    }
    actor.settings.qq = {
      ...config,
      conversations: config.conversations.map((conversation) => ({
        ...conversation,
      })),
    };
    actor.updatedAt = new Date().toISOString();
    return true;
  });
}
