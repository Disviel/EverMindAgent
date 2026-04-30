import "server-only";

import { getDbSnapshot, updateDb } from "@/server/store/db";
import { conversationKey } from "@/server/store/schema";
import type { ConversationMessage, InputContent, MessageReplyRef } from "@/types/chat/v1beta1";

export async function listConversationMessages(actorId: string, session: string) {
  const db = await getDbSnapshot();
  return db.messages[conversationKey(actorId, session)] ?? [];
}

export async function appendConversationMessage({
  actorId,
  session,
  message,
}: {
  actorId: string;
  session: string;
  message: ConversationMessage;
}) {
  return updateDb((db) => {
    const key = conversationKey(actorId, session);
    db.messages[key] ??= [];
    db.messages[key].push(message);
    return message;
  });
}

export async function createConversationMessage({
  actorId,
  session,
  kind,
  name,
  uid,
  contents,
  replyTo,
  time = Date.now(),
}: {
  actorId: string;
  session: string;
  kind: "user" | "actor";
  name: string;
  uid?: string;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
  time?: number;
}) {
  return updateDb((db) => {
    const key = conversationKey(actorId, session);
    db.messages[key] ??= [];
    const msgId =
      db.messages[key].reduce(
        (maxMsgId, message) => Math.max(maxMsgId, message.msgId ?? 0),
        0,
      ) + 1;
    const message: ConversationMessage =
      kind === "user"
        ? {
            kind,
            msgId,
            time,
            uid: uid ?? "current-user",
            name,
            contents,
            ...(replyTo ? { replyTo } : {}),
          }
        : {
            kind,
            msgId,
            time,
            name,
            contents,
            ...(replyTo ? { replyTo } : {}),
          };
    db.messages[key].push(message);
    return message;
  });
}

export function previewFromContents(contents: InputContent[]) {
  return (
    contents
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
      .join(" ") || "消息"
  );
}
