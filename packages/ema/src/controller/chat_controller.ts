import { buildSession } from "../channel";
import type { ConversationMessageEntity } from "../db";
import type { InputContent } from "../shared/schema";
import type { Server } from "../server";
import type {
  ChatHistoryInput,
  ChatHistoryResult,
  ConversationMessageStreamEvent,
  ConversationMessageStreamHandler,
  SendWebMessageInput,
  SendWebMessageResult,
} from "./types";

const DEFAULT_HISTORY_LIMIT = 80;
const MAX_HISTORY_LIMIT = 200;
const MAX_INLINE_IMAGES = 3;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export class ChatController {
  private readonly conversationListeners = new Map<
    number,
    Set<ConversationMessageStreamHandler>
  >();

  constructor(private readonly server: Server) {}

  subscribeConversation(
    conversationId: number,
    handler: ConversationMessageStreamHandler,
  ): () => void {
    let listeners = this.conversationListeners.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      this.conversationListeners.set(conversationId, listeners);
    }
    listeners.add(handler);
    return () => {
      const current = this.conversationListeners.get(conversationId);
      if (!current) {
        return;
      }
      current.delete(handler);
      if (current.size === 0) {
        this.conversationListeners.delete(conversationId);
      }
    };
  }

  async publishConversationMessage(
    conversationId: number,
    msgId: number,
    metadata: { correlationId?: string } = {},
  ): Promise<ConversationMessageStreamEvent | null> {
    const rows =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId,
          msgIds: [msgId],
          limit: 1,
        },
      );
    const message = rows[0];
    if (!message) {
      return null;
    }
    const conversation =
      await this.server.dbService.conversationDB.getConversation(conversationId);
    if (!conversation || typeof conversation.id !== "number") {
      return null;
    }
    const event: ConversationMessageStreamEvent = {
      actorId: conversation.actorId,
      conversationId,
      session: conversation.session,
      message,
      ...(metadata.correlationId
        ? { correlationId: metadata.correlationId }
        : {}),
    };
    const listeners = this.conversationListeners.get(conversationId);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
    await this.publishLatestPreview(conversation.actorId, message);
    return event;
  }

  async listHistory(input: ChatHistoryInput): Promise<ChatHistoryResult> {
    const limit = Math.max(
      1,
      Math.min(input.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT),
    );
    const conversation = await this.requireConversation(
      input.actorId,
      input.session,
    );
    const allMessages =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId: conversation.id,
          sort: "asc",
        },
      );
    const filtered =
      typeof input.beforeMsgId === "number"
        ? allMessages.filter((message) => message.msgId < input.beforeMsgId!)
        : allMessages;
    const messages = filtered.slice(-limit);
    const firstMsgId = messages[0]?.msgId;
    const hasMore =
      typeof firstMsgId === "number"
        ? filtered.some((message) => message.msgId < firstMsgId)
        : false;
    return {
      actorId: input.actorId,
      session: input.session,
      messages,
      pagination: {
        limit,
        hasMore,
        ...(hasMore && typeof firstMsgId === "number"
          ? { nextBeforeMsgId: firstMsgId }
          : {}),
      },
    };
  }

  async sendWebMessage(
    input: SendWebMessageInput,
  ): Promise<SendWebMessageResult> {
    validateSendContents(input.contents);
    const session = buildSession("web", "chat", String(input.ownerUserId));
    const conversation = await this.ensureWebConversation(
      input.actorId,
      input.ownerUserId,
      input.ownerName,
    );
    const result = await this.server.gateway.dispatchChannel(input.actorId, {
      kind: "chat",
      channel: "web",
      session,
      channelMessageId: input.correlationId,
      speaker: {
        session,
        uid: String(input.ownerUserId),
        name: input.ownerName,
      },
      inputs: input.contents,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      time: input.time ?? Date.now(),
    });
    if (!result.ok || typeof result.msgId !== "number") {
      throw new Error(result.msg || "Failed to send web message.");
    }
    const event = await this.publishConversationMessage(
      conversation.id,
      result.msgId,
      { correlationId: input.correlationId },
    );
    if (!event) {
      throw new Error(`Message ${result.msgId} was not found after send.`);
    }
    return {
      correlationId: input.correlationId,
      conversation,
      message: event.message,
    };
  }

  async ensureWebConversation(
    actorId: number,
    ownerUserId: number,
    ownerName: string,
  ) {
    const conversation = await this.server.dbService.createConversation(
      actorId,
      buildSession("web", "chat", String(ownerUserId)),
      ownerName || "Web Chat",
      "Default web conversation.",
      false,
    );
    if (typeof conversation.id !== "number") {
      throw new Error("Conversation is missing id after creation.");
    }
    return conversation as typeof conversation & { id: number };
  }

  private async requireConversation(actorId: number, session: string) {
    const conversation =
      await this.server.dbService.getConversationBySession(actorId, session);
    if (!conversation || typeof conversation.id !== "number") {
      throw new Error(`Conversation ${session} not found.`);
    }
    return conversation as typeof conversation & { id: number };
  }

  private async publishLatestPreview(
    actorId: number,
    message: ConversationMessageEntity,
  ): Promise<void> {
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.latest_preview",
        actorId,
        data: {
          text: previewFromContents(message.message.contents),
          time: message.createdAt ?? Date.now(),
          msgId: message.msgId,
        },
      }),
    );
  }
}

export function previewFromContents(contents: InputContent[]): string {
  const preview = contents
    .map((content) => {
      if (content.type === "text") {
        return content.text.trim();
      }
      if (content.mimeType.startsWith("image/")) {
        return "[图片]";
      }
      return `[${content.mimeType}]`;
    })
    .filter(Boolean)
    .join(" ");
  return preview || "[空消息]";
}

function validateSendContents(contents: InputContent[]): void {
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new Error("Message contents are required.");
  }
  let imageCount = 0;
  for (const content of contents) {
    if (
      content.type !== "inline_data" ||
      !content.mimeType.startsWith("image/")
    ) {
      continue;
    }
    imageCount += 1;
    if (imageCount > MAX_INLINE_IMAGES) {
      throw new Error(`At most ${MAX_INLINE_IMAGES} images can be sent.`);
    }
    if (estimateBase64Bytes(content.data) > MAX_INLINE_IMAGE_BYTES) {
      throw new Error("Image exceeds 5MB limit.");
    }
  }
}

function estimateBase64Bytes(data: string): number {
  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  return Math.floor((base64.length * 3) / 4);
}
