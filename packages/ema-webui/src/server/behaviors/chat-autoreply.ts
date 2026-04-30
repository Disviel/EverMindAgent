import "server-only";

import { createEvent, publishEvent } from "@/server/events/bus";
import { getActorRecord } from "@/server/store/actors";
import {
  createConversationMessage,
  previewFromContents,
} from "@/server/store/messages";
import type { ConversationMessage } from "@/types/chat/v1beta1";

const REPLIES = [
  "我收到了，先把这条记录放进上下文里。",
  "明白，我会顺着这个方向继续整理。",
  "这部分我记下了，后面可以继续展开。",
  "好的，我会保持当前节奏，不打断你的思路。",
];

function delay(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export function scheduleActorAutoReply({
  actorId,
  session,
  source,
}: {
  actorId: string;
  session: string;
  source: ConversationMessage;
}) {
  void (async () => {
    const actor = await getActorRecord(actorId);
    if (!actor || actor.status === "offline" || actor.status === "preparing") {
      return;
    }

    await delay(1000 + Math.floor(Math.random() * 2000));
    const message = await createConversationMessage({
      actorId,
      session,
      kind: "actor",
      name: actor.name,
      contents: [
        {
          type: "text",
          text: REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? REPLIES[0],
        },
      ],
      replyTo:
        typeof source.msgId === "number"
          ? { kind: "msg", msgId: source.msgId }
          : undefined,
    });

    publishEvent(
      createEvent({
        type: "conversation.message.created",
        actorId,
        conversationId: session,
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
  })();
}
