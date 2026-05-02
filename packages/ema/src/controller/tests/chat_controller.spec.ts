import { describe, expect, test, vi } from "vitest";

import { EmaBus } from "../../bus";
import { ChatController } from "../chat_controller";

function createFixture() {
  const conversations = new Map([
    [
      1,
      {
        id: 1,
        actorId: 1,
        session: "web-chat-1",
        name: "Web Chat",
        description: "",
        allowProactive: false,
      },
    ],
    [
      2,
      {
        id: 2,
        actorId: 1,
        session: "qq-chat-10001",
        name: "QQ Chat",
        description: "",
        allowProactive: false,
      },
    ],
  ]);
  const messages = new Map([
    [
      "1:10",
      {
        id: 101,
        conversationId: 1,
        actorId: 1,
        msgId: 10,
        channelMessageId: "10",
        message: {
          kind: "user" as const,
          msgId: 10,
          uid: "1",
          name: "Owner",
          contents: [{ type: "text" as const, text: "hello" }],
        },
        createdAt: 1000,
      },
    ],
  ]);
  const runtime = {
    isProcessingConversation: vi.fn((conversationId: number) => {
      return conversationId === 1;
    }),
  };
  const server = {
    actorRegistry: {
      get: vi.fn(() => runtime),
    },
    bus: new EmaBus(),
    dbService: {
      getConversationBySession: vi.fn(
        async (actorId: number, session: string) =>
          Array.from(conversations.values()).find(
            (item) => item.actorId === actorId && item.session === session,
          ) ?? null,
      ),
      conversationDB: {
        getConversation: vi.fn(async (conversationId: number) => {
          return conversations.get(conversationId) ?? null;
        }),
      },
      conversationMessageDB: {
        listConversationMessages: vi.fn(
          async ({
            conversationId,
            msgIds,
          }: {
            conversationId?: number;
            msgIds?: number[];
          }) => {
            if (typeof conversationId !== "number" || !msgIds?.length) {
              return [];
            }
            return msgIds
              .map((msgId) => messages.get(`${conversationId}:${msgId}`))
              .filter(Boolean);
          },
        ),
      },
    },
  };

  return {
    controller: new ChatController(server as never),
    runtime,
  };
}

describe("ChatController stream", () => {
  test("publishes message and typing events only to the target conversation", async () => {
    const { controller } = createFixture();
    const conversationOneEvents: unknown[] = [];
    const conversationTwoEvents: unknown[] = [];

    controller.subscribeConversation(1, (event) => {
      conversationOneEvents.push(event);
    });
    controller.subscribeConversation(2, (event) => {
      conversationTwoEvents.push(event);
    });

    await controller.publishConversationTyping(1, true);
    await controller.publishConversationMessage(1, 10, {
      correlationId: "correlation-1",
    });

    expect(conversationOneEvents).toEqual([
      expect.objectContaining({
        type: "typing.changed",
        conversationId: 1,
        typing: true,
      }),
      expect.objectContaining({
        type: "message.created",
        conversationId: 1,
        correlationId: "correlation-1",
      }),
    ]);
    expect(conversationTwoEvents).toEqual([]);
  });

  test("reads typing snapshots from the actor runtime current conversation", async () => {
    const { controller, runtime } = createFixture();

    const webSnapshot = await controller.getConversationTypingSnapshot(
      1,
      "web-chat-1",
    );
    const qqSnapshot = await controller.getConversationTypingSnapshot(
      1,
      "qq-chat-10001",
    );

    expect(runtime.isProcessingConversation).toHaveBeenCalledWith(1);
    expect(runtime.isProcessingConversation).toHaveBeenCalledWith(2);
    expect(webSnapshot).toMatchObject({
      type: "typing.changed",
      conversationId: 1,
      typing: true,
    });
    expect(qqSnapshot).toMatchObject({
      type: "typing.changed",
      conversationId: 2,
      typing: false,
    });
  });
});
