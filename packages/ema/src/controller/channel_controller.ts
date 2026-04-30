import type { ChannelConfig } from "../config";
import { buildSession, resolveSession } from "../channel";
import type { ConversationEntity } from "../db";
import type { Server } from "../server";
import type { QQConversationInput } from "./types";

export type QQConnectionStatus =
  | "disabled"
  | "unconfigured"
  | "connecting"
  | "connected"
  | "failed";

export class ChannelController {
  constructor(private readonly server: Server) {}

  async saveQqConfig(
    actorId: number,
    config: ChannelConfig["qq"],
  ): Promise<ChannelConfig["qq"]> {
    if (config.enabled) {
      if (!config.wsUrl.trim()) {
        throw new Error("QQ wsUrl is required when QQ is enabled.");
      }
      if (!config.accessToken.trim()) {
        throw new Error("QQ accessToken is required when QQ is enabled.");
      }
    }
    const actor = await this.requireActor(actorId);
    const current = await this.server.dbService.getActorChannelConfig(actorId);
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      channelConfig: {
        ...current,
        qq: config,
      },
    });
    if (actor.enabled) {
      await this.server.gateway.channelRegistry.refreshActorChannels(actorId);
    }
    await this.publishQqStatus(actorId);
    await this.server.controller.actor.publishUpdated(actorId);
    return config;
  }

  async listQqConversations(actorId: number): Promise<ConversationEntity[]> {
    const conversations =
      await this.server.dbService.conversationDB.listConversations({
        actorId,
      });
    return conversations.filter((conversation) => {
      const session = resolveSession(conversation.session);
      return session?.channel === "qq";
    });
  }

  async addQqConversation(
    actorId: number,
    input: QQConversationInput,
  ): Promise<ConversationEntity & { id: number }> {
    const session = buildSession("qq", input.type, input.uid.trim());
    const existing =
      await this.server.dbService.conversationDB.getConversationByActorAndSession(
        actorId,
        session,
      );
    if (existing) {
      throw new Error(`QQ conversation ${session} already exists.`);
    }
    return await this.upsertQqConversation(actorId, session, input);
  }

  async updateQqConversation(
    actorId: number,
    conversationId: number,
    input: Omit<QQConversationInput, "type" | "uid">,
  ): Promise<ConversationEntity & { id: number }> {
    const current =
      await this.server.dbService.conversationDB.getConversation(conversationId);
    if (
      !current ||
      current.actorId !== actorId ||
      typeof current.id !== "number"
    ) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
    const session = resolveSession(current.session);
    if (session?.channel !== "qq") {
      throw new Error(
        `Conversation ${conversationId} is not a QQ conversation.`,
      );
    }
    return await this.upsertQqConversation(
      actorId,
      current.session,
      {
        type: session.type,
        uid: session.uid,
        name: input.name,
        description: input.description,
        allowProactive: input.allowProactive,
      },
      current.id,
    );
  }

  async deleteQqConversation(
    actorId: number,
    conversationId: number,
  ): Promise<boolean> {
    const current =
      await this.server.dbService.conversationDB.getConversation(conversationId);
    if (!current || current.actorId !== actorId) {
      return false;
    }
    const session = resolveSession(current.session);
    if (session?.channel !== "qq") {
      return false;
    }
    return await this.server.dbService.conversationDB.deleteConversation(
      conversationId,
    );
  }

  async getQqStatus(actorId: number): Promise<QQConnectionStatus> {
    const config = await this.server.dbService.getActorChannelConfig(actorId);
    if (!config.qq.enabled) {
      return "disabled";
    }
    if (!config.qq.wsUrl.trim() || !config.qq.accessToken.trim()) {
      return "unconfigured";
    }
    return this.server.gateway?.channelRegistry.getActorChannelStatus(
      actorId,
      "qq",
    ) ?? "failed";
  }

  async restartQq(actorId: number): Promise<QQConnectionStatus> {
    await this.server.gateway.channelRegistry.restartActorChannel(actorId, "qq");
    return await this.publishQqStatus(actorId);
  }

  async publishQqStatus(actorId: number): Promise<QQConnectionStatus> {
    const status = await this.getQqStatus(actorId);
    const config = await this.server.dbService.getActorChannelConfig(actorId);
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "channel.qq.connection.changed",
        actorId,
        data: {
          status,
          endpoint: config.qq.wsUrl,
          enabled: config.qq.enabled,
          checkedAt: Date.now(),
        },
      }),
    );
    return status;
  }

  private async upsertQqConversation(
    actorId: number,
    session: string,
    input: QQConversationInput,
    id?: number,
  ): Promise<ConversationEntity & { id: number }> {
    const conversationId =
      await this.server.dbService.conversationDB.upsertConversation({
        ...(id ? { id } : {}),
        actorId,
        session,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        allowProactive: input.allowProactive === true,
      });
    const conversation =
      await this.server.dbService.conversationDB.getConversation(conversationId);
    if (!conversation || typeof conversation.id !== "number") {
      throw new Error(`Conversation ${conversationId} not found after save.`);
    }
    return conversation as ConversationEntity & { id: number };
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as typeof actor & { id: number };
  }
}
