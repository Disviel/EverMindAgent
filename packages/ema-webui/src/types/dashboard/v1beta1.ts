export type ActorRuntimeStatus =
  | "offline"
  | "sleep"
  | "online"
  | "busy";
export type ActorRuntimeTransition =
  | "booting"
  | "shutting_down"
  | "waking"
  | "sleeping"
  | null;
export type ActorLlmProvider = "google" | "openai";
export type ActorOpenAiMode = "responses" | "chat";
export type ActorSettingsCheckStatus = "passed" | "failed";
export type ActorSettingsSaveStatus = "saved" | "failed";
export type ActorSettingsCheckErrorCode =
  | "INVALID_CONFIG"
  | "UNSUPPORTED"
  | "LLM_PROVIDER_ERROR"
  | "LLM_NETWORK_ERROR"
  | "CHECK_FAILED";
export type ActorSettingsSaveErrorCode =
  | "INVALID_CONFIG"
  | "DATABASE_WRITE_FAILED"
  | "CHECK_FAILED";
export type ActorSettingsDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];
export type ActorSettingsDiagnostics = Record<
  string,
  ActorSettingsDiagnosticValue
>;

export interface DashboardUserProfile {
  id: string;
  name: string;
}

export interface ActorSettingsSnapshot {
  llm?: ActorLlmConfig;
  webSearch?: ActorWebSearchConfig;
  qq?: ActorQQConfig;
}

export interface ActorSummary {
  id: string;
  name: string;
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
  latestPreview?: {
    text: string;
    time: number;
  };
  settings?: ActorSettingsSnapshot;
}

export interface ActorActivityState {
  enabled: boolean;
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
  switching: boolean;
  updatedAt: string;
}

export interface ActorActivityUpdateRequest {
  requestId?: string;
  enabled: boolean;
}

export interface ActorActivityUpdateResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  activity: ActorActivityState;
  error?: {
    code: "ACTIVITY_SWITCH_FAILED";
    retryable: boolean;
    message: string;
  };
}

export interface DashboardOverviewResponse {
  apiVersion: "v1beta1";
  generatedAt: string;
  user: DashboardUserProfile;
  actors: ActorSummary[];
}

export interface OwnerResponse {
  apiVersion: "v1beta1";
  user: DashboardUserProfile;
}

export interface ActorListResponse {
  apiVersion: "v1beta1";
  generatedAt: string;
  actors: ActorSummary[];
}

export interface ActorSettingsResponse {
  apiVersion: "v1beta1";
  actorId: string;
  settings: ActorSettingsSnapshot;
  global: {
    llm: ActorLlmConfig;
    webSearch: ActorWebSearchConfig;
  };
}

export interface CreateActorRequest {
  name: string;
  avatarUrl?: string;
  roleBook: string;
  sleepSchedule: {
    startMinutes: number;
    endMinutes: number;
  };
}

export interface CreateActorResponse {
  apiVersion: "v1beta1";
  actor: ActorSummary;
}

/** Actor-scoped LLM config DTO mirrored from EMA's runtime LLMConfig. */
export interface ActorLlmConfig {
  provider: ActorLlmProvider;
  openai: {
    mode: ActorOpenAiMode;
    model: string;
    baseUrl: string;
    apiKey: string;
  };
  google: {
    model: string;
    baseUrl: string;
    apiKey: string;
    useVertexAi: boolean;
    project: string;
    location: string;
    credentialsFile: string;
  };
}

export interface ActorLlmCheckRequest {
  requestId?: string;
  attempt?: number;
  config: ActorLlmConfig;
}

export interface ActorLlmCheckResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  check: {
    id: string;
    target: "llm";
    actorId: string;
    status: ActorSettingsCheckStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsCheckErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorLlmSaveRequest {
  requestId?: string;
  config: ActorLlmConfig;
}

export interface ActorLlmSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "llm";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

/** Actor-scoped web search config DTO mirrored from EMA's WebSearchConfig. */
export interface ActorWebSearchConfig {
  enabled: boolean;
  tavilyApiKey: string;
}

export interface ActorWebSearchSaveRequest {
  requestId?: string;
  config: ActorWebSearchConfig;
}

export interface ActorWebSearchSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "webSearch";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

/** Actor-scoped QQ channel config DTO mirrored from EMA's ChannelConfig.qq. */
export type ActorQQConversationType = "chat" | "group";

export interface ActorQQConversation {
  id: string;
  type: ActorQQConversationType;
  uid: string;
  name: string;
  description: string;
  allowProactive: boolean;
}

export interface ActorQQConfig {
  enabled: boolean;
  wsUrl: string;
  accessToken: string;
  conversations: ActorQQConversation[];
}

export type ActorQQTransportStatus =
  | "connected"
  | "connecting"
  | "disconnected";

export type ActorQQBlockedBy = "actor_offline" | "qq_disabled" | null;

export type ActorQQConnectionSyncReason =
  | "initial"
  | "configChanged"
  | "poll"
  | "retry";

export interface ActorQQConnectionStatusRequest {
  requestId?: string;
  reason?: ActorQQConnectionSyncReason;
}

export interface ActorQQConnectionStatusResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  connection: {
    id: string;
    target: "qq";
    actorId: string;
    transportStatus: ActorQQTransportStatus;
    blockedBy: ActorQQBlockedBy;
    reason: ActorQQConnectionSyncReason;
    endpoint: string;
    enabled: boolean;
    checkedAt: string;
    retryable: boolean;
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorQQChannelResponse {
  apiVersion: "v1beta1";
  actorId: string;
  config: ActorQQConfig;
  connection: ActorQQConnectionStatusResponse["connection"] | null;
}

export interface ActorQQSaveRequest {
  requestId?: string;
  config: ActorQQConfig;
}

export interface ActorQQSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "qq";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorQQEnabledUpdateRequest {
  requestId?: string;
  enabled: boolean;
}

export interface ActorQQEnabledUpdateResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  config: ActorQQConfig;
  connection: ActorQQConnectionStatusResponse["connection"];
  error?: {
    code: ActorSettingsSaveErrorCode;
    retryable: boolean;
    message: string;
    details: ActorSettingsDiagnostics;
  };
}

export interface ActorQQConversationListResponse {
  apiVersion: "v1beta1";
  actorId: string;
  conversations: ActorQQConversation[];
}

export interface ActorQQConversationCreateRequest {
  requestId?: string;
  conversation: Omit<ActorQQConversation, "id">;
}

export interface ActorQQConversationPatchRequest {
  requestId?: string;
  patch: Partial<
    Pick<ActorQQConversation, "name" | "description" | "allowProactive">
  >;
}

export interface ActorQQConversationMutationResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  conversation?: ActorQQConversation;
  conversationId?: string;
  error?: {
    code: "INVALID_CONFIG" | "CONVERSATION_EXISTS" | "CONVERSATION_NOT_FOUND";
    retryable: boolean;
    message: string;
  };
}
