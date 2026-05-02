import type { ConversationMessage } from "@/types/chat/v1beta1";
import type {
  ActorQQBlockedBy,
  ActorQQTransportStatus,
  ActorRuntimeStatus,
  ActorSummary,
} from "@/types/dashboard/v1beta1";

export type EmaEventTopic =
  | "actor.created"
  | "actor.updated"
  | "actor.deleted"
  | "actor.runtime.changed"
  | "actor.latest_preview"
  | "actor.unread.changed"
  | "conversation.message.created"
  | "channel.qq.connection.changed";

export type EmaEvent<T extends EmaEventTopic = EmaEventTopic, D = unknown> = {
  type: T;
  ts: number;
  correlationId?: string;
  actorId?: string;
  conversationId?: string;
  data: D;
};

export interface ActorCreatedEventData {
  actor: ActorSummary;
}

export interface ActorUpdatedEventData {
  actor: ActorSummary;
}

export interface ActorRuntimeChangedEventData {
  status: ActorRuntimeStatus;
}

export interface ActorLatestPreviewEventData {
  text: string;
  time: number;
}

export interface ActorUnreadChangedEventData {
  count: number;
}

export interface ConversationMessageCreatedEventData {
  message: ConversationMessage;
}

export interface ChannelQqConnectionChangedEventData {
  transportStatus: ActorQQTransportStatus;
  blockedBy: ActorQQBlockedBy;
  endpoint: string;
  enabled: boolean;
  checkedAt: string;
  retryable: boolean;
}

export type EmaKnownEvent =
  | EmaEvent<"actor.created", ActorCreatedEventData>
  | EmaEvent<"actor.updated", ActorUpdatedEventData>
  | EmaEvent<"actor.deleted", { actorId: string }>
  | EmaEvent<"actor.runtime.changed", ActorRuntimeChangedEventData>
  | EmaEvent<"actor.latest_preview", ActorLatestPreviewEventData>
  | EmaEvent<"actor.unread.changed", ActorUnreadChangedEventData>
  | EmaEvent<"conversation.message.created", ConversationMessageCreatedEventData>
  | EmaEvent<"channel.qq.connection.changed", ChannelQqConnectionChangedEventData>;
