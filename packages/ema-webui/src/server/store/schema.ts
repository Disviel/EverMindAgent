import "server-only";

import type { ConversationMessage } from "@/types/chat/v1beta1";
import type {
  ActorLlmConfig,
  ActorQQConfig,
  ActorQQConnectionStatus,
  ActorRuntimeStatus,
  ActorSummary,
  ActorWebSearchConfig,
} from "@/types/dashboard/v1beta1";
import type { SetupDraft } from "@/types/setup/v1beta1";

export interface MockUserRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockActorRecord {
  id: string;
  name: string;
  avatarUrl?: string;
  roleBook: string;
  sleepSchedule: {
    startMinutes: number;
    endMinutes: number;
  };
  enabled: boolean;
  status: ActorRuntimeStatus;
  createdAt: string;
  updatedAt: string;
  settings: {
    llm?: ActorLlmConfig;
    webSearch?: ActorWebSearchConfig;
    qq: ActorQQConfig;
  };
}

export interface MockQqConnectionRecord {
  actorId: string;
  status: ActorQQConnectionStatus;
  endpoint: string;
  enabled: boolean;
  checkedAt: string;
}

export interface MockDb {
  apiVersion: "v1beta1";
  updatedAt: string;
  user?: MockUserRecord;
  setupDraft?: SetupDraft;
  actors: MockActorRecord[];
  messages: Record<string, ConversationMessage[]>;
  qqConnections: Record<string, MockQqConnectionRecord>;
}

export const DEFAULT_QQ_CONFIG: ActorQQConfig = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
  conversations: [],
};

export function createEmptyMockDb(): MockDb {
  return {
    apiVersion: "v1beta1",
    updatedAt: new Date().toISOString(),
    actors: [],
    messages: {},
    qqConnections: {},
  };
}

export function toActorSummary(actor: MockActorRecord): ActorSummary {
  return {
    id: actor.id,
    name: actor.name,
    status: actor.status,
    settings: {
      ...actor.settings,
      qq: {
        ...actor.settings.qq,
        conversations: actor.settings.qq.conversations.map((conversation) => ({
          ...conversation,
        })),
      },
    },
  };
}

export function conversationKey(actorId: string, session: string) {
  return `${actorId}:${session}`;
}
