import "server-only";

import { scheduleActorAutoReply } from "@/server/behaviors/chat-autoreply";
import { createEvent, publishEvent } from "@/server/events/bus";
import { getActorRecord } from "@/server/store/actors";
import {
  createConversationMessage,
  listConversationMessages,
  previewFromContents,
} from "@/server/store/messages";
import type {
  ChatHistoryResponse,
  GetChatHistoryParams,
  SendMessageRequest,
  SendMessageResponse,
} from "@/types/chat/v1beta1";

const API_VERSION = "v1beta1" as const;
const DEFAULT_LIMIT = 80;
const USER_UID = "current-user";

export async function buildChatHistory({
  actorId,
  session,
  limit = DEFAULT_LIMIT,
  beforeMsgId,
}: GetChatHistoryParams): Promise<ChatHistoryResponse> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const allMessages = await listConversationMessages(actorId, session);
  const filteredMessages =
    typeof beforeMsgId === "number"
      ? allMessages.filter((message) => (message.msgId ?? 0) < beforeMsgId)
      : allMessages;
  const messages = filteredMessages.slice(-safeLimit);
  const firstMsgId = messages[0]?.msgId;
  const hasMore =
    typeof firstMsgId === "number"
      ? filteredMessages.some((message) => (message.msgId ?? 0) < firstMsgId)
      : false;

  return {
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    actorId,
    session,
    messages,
    pagination: {
      limit: safeLimit,
      hasMore,
      ...(hasMore && typeof firstMsgId === "number"
        ? { nextBeforeMsgId: firstMsgId }
        : {}),
    },
  };
}

export async function sendConversationMessage({
  actorId,
  session,
  userName,
  request,
}: {
  actorId: string;
  session: string;
  userName: string;
  request: SendMessageRequest;
}): Promise<SendMessageResponse> {
  const actor = await getActorRecord(actorId);
  if (!actor) {
    throw new Error("actor not found");
  }
  if (!Array.isArray(request.contents) || request.contents.length === 0) {
    throw new Error("message contents required");
  }

  const message = await createConversationMessage({
    actorId,
    session,
    kind: "user",
    uid: USER_UID,
    name: userName,
    contents: request.contents,
    replyTo: request.replyTo,
  });

  publishEvent(
    createEvent({
      type: "conversation.message.created",
      actorId,
      conversationId: session,
      correlationId: request.correlationId,
      data: { message },
    }),
  );
  publishEvent(
    createEvent({
      type: "actor.latest_preview",
      actorId,
      data: {
        text: previewFromContents(message.contents),
        time: message.time ?? Date.now(),
      },
    }),
  );

  scheduleActorAutoReply({
    actorId,
    session,
    source: message,
  });

  return {
    apiVersion: API_VERSION,
    correlationId: request.correlationId,
    msgId: message.msgId ?? 0,
    message,
  };
}
