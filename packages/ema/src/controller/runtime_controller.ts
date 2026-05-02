import type { Server } from "../server";
import type { ActorEntity } from "../db";
import type { ActorRuntimeSnapshot, ActorRuntimeStatus } from "./types";

type PersistedActor = ActorEntity & { id: number };

export class RuntimeController {
  private readonly runtimeOperations = new Map<
    number,
    Promise<ActorRuntimeSnapshot>
  >();

  constructor(private readonly server: Server) {}

  async getSnapshot(actorId: number): Promise<ActorRuntimeSnapshot> {
    const actorEntity = await this.server.dbService.actorDB.getActor(actorId);
    const runtime = this.server.actorRegistry?.get(actorId) ?? null;
    const enabled = actorEntity?.enabled === true;
    return {
      actorId,
      enabled,
      status: toRuntimeStatus(enabled, runtime),
      updatedAt: Date.now(),
    };
  }

  async getStatus(actorId: number): Promise<ActorRuntimeStatus> {
    return (await this.getSnapshot(actorId)).status;
  }

  async enable(actorId: number): Promise<ActorRuntimeSnapshot> {
    return await this.runLocked(actorId, async () => {
      const actor = await this.requireActor(actorId);
      const current = await this.getSnapshot(actorId);
      if (current.status !== "offline") {
        throw new Error(
          `Actor ${actorId} runtime cannot be enabled from ${current.status}.`,
        );
      }

      await this.server.dbService.actorDB.upsertActor({
        ...actor,
        enabled: true,
      });
      await this.publishStatus(actorId, "enable:start", "preparing");

      try {
        const runtime = await this.server.actorRegistry.ensure(actorId);
        await this.server.gateway.channelRegistry.refreshActorChannels(actorId);
        await runtime.startBootInit();
        const snapshot = await this.getSnapshot(actorId);
        await this.publishStatus(actorId, "enable:accepted", snapshot.status);
        return snapshot;
      } catch (error) {
        await this.rollbackEnable(actor);
        throw error;
      }
    });
  }

  async disable(actorId: number): Promise<ActorRuntimeSnapshot> {
    return await this.runLocked(actorId, async () => {
      const actor = await this.requireActor(actorId);
      const current = await this.getSnapshot(actorId);
      if (current.status === "offline" || current.status === "preparing") {
        throw new Error(
          `Actor ${actorId} runtime cannot be disabled from ${current.status}.`,
        );
      }

      await this.server.dbService.actorDB.upsertActor({
        ...actor,
        enabled: false,
      });
      await this.publishStatus(actorId, "disable:start", "preparing");

      try {
        await this.server.actorRegistry.unload(actorId);
        await this.server.gateway.channelRegistry.removeActorChannels(actorId);
        const snapshot = await this.getSnapshot(actorId);
        await this.publishStatus(actorId, "disable:complete", "offline");
        return {
          ...snapshot,
          enabled: false,
          status: "offline",
        };
      } catch (error) {
        await this.rollbackDisable(actor);
        throw error;
      }
    });
  }

  async publishStatus(
    actorId: number,
    reason?: string,
    explicitStatus?: ActorRuntimeStatus,
  ): Promise<void> {
    const snapshot = explicitStatus
      ? {
          ...(await this.getSnapshot(actorId)),
          status: explicitStatus,
        }
      : await this.getSnapshot(actorId);
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.runtime.changed",
        actorId,
        data: {
          ...snapshot,
          reason: reason ?? null,
        },
      }),
    );
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as PersistedActor;
  }

  private async runLocked(
    actorId: number,
    run: () => Promise<ActorRuntimeSnapshot>,
  ): Promise<ActorRuntimeSnapshot> {
    const current = this.runtimeOperations.get(actorId);
    if (current) {
      throw new Error(`Actor ${actorId} runtime operation is in progress.`);
    }
    const task = run().finally(() => {
      if (this.runtimeOperations.get(actorId) === task) {
        this.runtimeOperations.delete(actorId);
      }
    });
    this.runtimeOperations.set(actorId, task);
    return await task;
  }

  private async rollbackEnable(actor: PersistedActor): Promise<void> {
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      enabled: false,
    });
    await this.server.actorRegistry.unload(actor.id);
    await this.server.gateway.channelRegistry.removeActorChannels(actor.id);
    await this.publishStatus(actor.id, "enable:rollback", "offline");
  }

  private async rollbackDisable(actor: PersistedActor): Promise<void> {
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      enabled: true,
    });
    try {
      await this.server.actorRegistry.ensure(actor.id);
      await this.server.gateway.channelRegistry.refreshActorChannels(actor.id);
    } finally {
      await this.publishStatus(actor.id, "disable:rollback");
    }
  }
}

function toRuntimeStatus(
  enabled: boolean,
  runtime: ReturnType<Server["actorRegistry"]["get"]> | null,
): ActorRuntimeStatus {
  if (!enabled || !runtime) {
    return "offline";
  }
  const status = runtime.getStatus();
  if (runtime.isPreparing() || status === "switching") {
    return "preparing";
  }
  if (status === "sleep") {
    return "sleeping";
  }
  return runtime.isBusy() ? "busy" : "online";
}
