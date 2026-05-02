import "server-only";

import { randomUUID } from "node:crypto";
import {
  toActorSummary,
  toDashboardOverviewResponse,
  toDashboardUserProfile,
  toWebRuntimeStatus,
} from "@/server/ema-adapter/dashboard";
import {
  DEFAULT_OWNER_USER_ID,
  toCoreActorId,
} from "@/server/ema-adapter/ids";
import {
  toWebLlmConfig,
  toWebQqBlockedBy,
  toWebQqConversation,
  toWebQqConfig,
  toWebQqTransportStatus,
  toWebSearchConfig,
} from "@/server/ema-adapter/settings";
import { ensureEmaServer } from "@/server/ema-server";
import type {
  ActorActivityUpdateRequest,
  ActorActivityUpdateResponse,
  ActorListResponse,
  ActorLlmCheckRequest,
  ActorLlmCheckResponse,
  ActorLlmConfig,
  ActorLlmSaveRequest,
  ActorLlmSaveResponse,
  ActorQQChannelResponse,
  ActorQQConfig,
  ActorQQConnectionSyncReason,
  ActorQQConnectionStatusRequest,
  ActorQQConnectionStatusResponse,
  ActorQQConversation,
  ActorQQConversationCreateRequest,
  ActorQQConversationListResponse,
  ActorQQConversationMutationResponse,
  ActorQQConversationPatchRequest,
  ActorQQEnabledUpdateRequest,
  ActorQQEnabledUpdateResponse,
  ActorQQSaveRequest,
  ActorQQSaveResponse,
  ActorSettingsResponse,
  ActorSettingsSnapshot,
  ActorSettingsCheckErrorCode,
  ActorSettingsDiagnostics,
  ActorSettingsSaveErrorCode,
  ActorWebSearchSaveRequest,
  ActorWebSearchSaveResponse,
  CreateActorRequest,
  CreateActorResponse,
  DashboardOverviewResponse,
  OwnerResponse,
} from "@/types/dashboard/v1beta1";

const API_VERSION = "v1beta1" as const;
const EMPTY_QQ_CONFIG: ActorQQConfig = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
  conversations: [],
};
const EMPTY_CORE_QQ_CONFIG = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
};

function now() {
  return new Date().toISOString();
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value || null;
  }
}

function selectedLlmConfig(config: ActorLlmConfig) {
  return config.provider === "openai" ? config.openai : config.google;
}

export async function buildDashboardOverview(): Promise<DashboardOverviewResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  const ownerUserId = setupStatus.owner?.id ?? DEFAULT_OWNER_USER_ID;
  const detailsList = await server.controller.actor.listForUser(ownerUserId);
  const actors = await Promise.all(
    detailsList.map(async (details) => {
      const [settings, qqConversations] = await Promise.all([
        server.controller.settings.getEffective(details.actor.id),
        server.controller.channel.listQqConversations(details.actor.id),
      ]);
      return toActorSummary(details, { settings, qqConversations });
    }),
  );

  return toDashboardOverviewResponse({
    user: setupStatus.owner,
    actors,
    generatedAt: now(),
  });
}

export async function buildOwnerResponse(): Promise<OwnerResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  return {
    apiVersion: API_VERSION,
    user: toDashboardUserProfile(setupStatus.owner),
  };
}

export async function buildActorListResponse(): Promise<ActorListResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  const ownerUserId = setupStatus.owner?.id ?? DEFAULT_OWNER_USER_ID;
  const detailsList = await server.controller.actor.listForUser(ownerUserId);
  return {
    apiVersion: API_VERSION,
    generatedAt: now(),
    actors: detailsList.map((details) => toActorSummary(details)),
  };
}

export async function buildActorSettingsResponse(
  actorId: string,
): Promise<ActorSettingsResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const globalDefaults = server.controller.settings.getGlobalDefaults();
  const global = {
    llm: toWebLlmConfig(globalDefaults.llm),
    webSearch: toWebSearchConfig(globalDefaults.webSearch),
  };
  const actor = await server.dbService.actorDB.getActor(coreActorId);
  if (!actor) {
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: {
        qq: { ...EMPTY_QQ_CONFIG, conversations: [] },
      },
      global,
    };
  }

  const qqConversations =
    await server.controller.channel.listQqConversations(coreActorId);
  const settings: ActorSettingsSnapshot = {
    ...(actor.llmConfig ? { llm: toWebLlmConfig(actor.llmConfig) } : {}),
    ...(actor.webSearchConfig
      ? { webSearch: toWebSearchConfig(actor.webSearchConfig) }
      : {}),
    qq: toWebQqConfig(
      actor.channelConfig?.qq ?? EMPTY_CORE_QQ_CONFIG,
      qqConversations,
    ),
  };

  return {
    apiVersion: API_VERSION,
    actorId,
    settings,
    global,
  };
}

export async function buildActorQqChannelResponse(
  actorId: string,
): Promise<ActorQQChannelResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const [channelConfig, conversations, connectionState] = await Promise.all([
    server.dbService.getActorChannelConfig(coreActorId),
    server.controller.channel.listQqConversations(coreActorId),
    server.controller.channel.getQqConnectionState(coreActorId),
  ]);
  const config = toWebQqConfig(channelConfig.qq, conversations);
  return {
    apiVersion: API_VERSION,
    actorId,
    config,
    connection: createQqConnectionResponse(actorId, connectionState, "poll")
      .connection,
  };
}

export async function listActorQqConversationsService(
  actorId: string,
): Promise<ActorQQConversationListResponse> {
  const server = await ensureEmaServer();
  const conversations = await server.controller.channel.listQqConversations(
    toCoreActorId(actorId),
  );
  return {
    apiVersion: API_VERSION,
    actorId,
    conversations: conversations
      .map(toWebQqConversation)
      .filter((item): item is ActorQQConversation => Boolean(item)),
  };
}

export async function createActorQqConversationService(
  actorId: string,
  request: Partial<ActorQQConversationCreateRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const conversation = request.conversation;
  if (!conversation) {
    return qqConversationError(actorId, "INVALID_CONFIG", "invalid conversation");
  }

  try {
    const server = await ensureEmaServer();
    const created = await server.controller.channel.addQqConversation(
      toCoreActorId(actorId),
      conversation,
    );
    const nextConversation = toWebQqConversation(created);
    if (!nextConversation) {
      return qqConversationError(
        actorId,
        "INVALID_CONFIG",
        "invalid conversation",
      );
    }
    await server.controller.actor.publishUpdated(toCoreActorId(actorId));
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: nextConversation,
    };
  } catch (error) {
    return qqConversationError(
      actorId,
      classifyQqConversationError(error),
      messageFromError(error),
    );
  }
}

export async function patchActorQqConversationService(
  actorId: string,
  conversationId: string,
  request: Partial<ActorQQConversationPatchRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const coreActorId = toCoreActorId(actorId);
  const coreConversationId = toCoreConversationId(conversationId);
  if (coreConversationId === null) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  try {
    const server = await ensureEmaServer();
    const current =
      await server.dbService.conversationDB.getConversation(coreConversationId);
    if (!current || current.actorId !== coreActorId) {
      return qqConversationError(
        actorId,
        "CONVERSATION_NOT_FOUND",
        "conversation not found",
      );
    }
    const currentWebConversation = toWebQqConversation(current);
    if (!currentWebConversation) {
      return qqConversationError(
        actorId,
        "CONVERSATION_NOT_FOUND",
        "conversation not found",
      );
    }
    const updated = await server.controller.channel.updateQqConversation(
      coreActorId,
      coreConversationId,
      {
        name: request.patch?.name ?? currentWebConversation.name,
        description:
          request.patch?.description ?? currentWebConversation.description,
        allowProactive:
          request.patch?.allowProactive ??
          currentWebConversation.allowProactive,
      },
    );
    const nextConversation = toWebQqConversation(updated);
    if (!nextConversation) {
      return qqConversationError(
        actorId,
        "INVALID_CONFIG",
        "invalid conversation",
      );
    }
    await server.controller.actor.publishUpdated(coreActorId);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: nextConversation,
    };
  } catch (error) {
    return qqConversationError(
      actorId,
      classifyQqConversationError(error),
      messageFromError(error),
    );
  }
}

export async function deleteActorQqConversationService(
  actorId: string,
  conversationId: string,
): Promise<ActorQQConversationMutationResponse> {
  const coreConversationId = toCoreConversationId(conversationId);
  if (coreConversationId === null) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  try {
    const server = await ensureEmaServer();
    const ok = await server.controller.channel.deleteQqConversation(
      toCoreActorId(actorId),
      coreConversationId,
    );
    if (ok) {
      await server.controller.actor.publishUpdated(toCoreActorId(actorId));
      return {
        apiVersion: API_VERSION,
        ok: true,
        actorId,
        conversationId,
      };
    }
  } catch {
    // Fall through to the stable not-found response.
  }
  return qqConversationError(
    actorId,
    "CONVERSATION_NOT_FOUND",
    "conversation not found",
  );
}

function qqConversationError(
  actorId: string,
  code: NonNullable<ActorQQConversationMutationResponse["error"]>["code"],
  message: string,
): ActorQQConversationMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable: false,
      message,
    },
  };
}

function createQqConnectionResponse(
  actorId: string,
  state: {
    enabled: boolean;
    endpoint: string;
    transportStatus: string;
    blockedBy: unknown;
    checkedAt: number;
    retryable: boolean;
  },
  reason: ActorQQConnectionSyncReason,
): ActorQQConnectionStatusResponse {
  return {
    apiVersion: API_VERSION,
    ok: true,
    connection: {
      id: `qq-connection-${actorId}`,
      target: "qq",
      actorId,
      transportStatus: toWebQqTransportStatus(state.transportStatus),
      blockedBy: toWebQqBlockedBy(state.blockedBy),
      reason,
      endpoint: state.endpoint,
      enabled: state.enabled,
      checkedAt: new Date(state.checkedAt).toISOString(),
      retryable: state.retryable,
      diagnostics: {},
    },
  };
}

function classifyQqConversationError(
  error: unknown,
): NonNullable<ActorQQConversationMutationResponse["error"]>["code"] {
  const message = messageFromError(error).toLowerCase();
  if (message.includes("already exists")) {
    return "CONVERSATION_EXISTS";
  }
  if (message.includes("not found")) {
    return "CONVERSATION_NOT_FOUND";
  }
  return "INVALID_CONFIG";
}

function toCoreConversationId(conversationId: string): number | null {
  const parsed = Number.parseInt(conversationId, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    String(parsed) !== conversationId
  ) {
    return null;
  }
  return parsed;
}

export async function createActorService(
  request: CreateActorRequest,
): Promise<CreateActorResponse> {
  const server = await ensureEmaServer();
  const details = await server.controller.actor.create({
    ownerUserId: DEFAULT_OWNER_USER_ID,
    name: request.name,
    avatarUrl: request.avatarUrl,
    roleBook: request.roleBook,
    sleepSchedule: request.sleepSchedule,
  });
  return {
    apiVersion: API_VERSION,
    actor: toActorSummary(details),
  };
}

export async function updateActorActivityService(
  actorId: string,
  request: ActorActivityUpdateRequest,
): Promise<ActorActivityUpdateResponse> {
  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const snapshot = request.enabled
      ? await server.controller.runtime.enable(coreActorId)
      : await server.controller.runtime.disable(coreActorId);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      activity: {
        enabled: snapshot.enabled,
        status: toWebRuntimeStatus(snapshot.status),
        switching: false,
        updatedAt: new Date(snapshot.updatedAt).toISOString(),
      },
    };
  } catch (error) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      actorId,
      activity: {
        enabled: false,
        status: "offline",
        switching: false,
        updatedAt: now(),
      },
      error: {
        code: "ACTIVITY_SWITCH_FAILED",
        retryable: true,
        message: error instanceof Error ? error.message : "runtime switch failed",
      },
    };
  }
}

function createActorLlmCheckResponse({
  actorId,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
  retryable = true,
}: {
  actorId: string;
  startedAt: string;
  ok: boolean;
  diagnostics: ActorSettingsDiagnostics;
  errorCode?: ActorSettingsCheckErrorCode;
  errorDetails?: ActorSettingsDiagnostics;
  retryable?: boolean;
}): ActorLlmCheckResponse {
  const finishedAt = now();
  return {
    apiVersion: API_VERSION,
    ok,
    check: {
      id: randomUUID(),
      target: "llm",
      actorId,
      status: ok ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(
        1,
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ),
      error: ok
        ? undefined
        : {
            code: errorCode ?? "CHECK_FAILED",
            retryable,
            details: errorDetails ?? {},
          },
      diagnostics,
    },
  };
}

function createSaveResponse<TTarget extends "llm" | "webSearch" | "qq">({
  target,
  actorId,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
}: {
  target: TTarget;
  actorId: string;
  startedAt: string;
  ok: boolean;
  diagnostics: ActorSettingsDiagnostics;
  errorCode?: ActorSettingsSaveErrorCode;
  errorDetails?: ActorSettingsDiagnostics;
}) {
  const finishedAt = now();
  return {
    apiVersion: API_VERSION,
    ok,
    save: {
      id: randomUUID(),
      target,
      actorId,
      status: ok ? "saved" : "failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(
        1,
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ),
      error: ok
        ? undefined
        : {
            code: errorCode ?? "DATABASE_WRITE_FAILED",
            retryable: true,
            details: errorDetails ?? {},
          },
      diagnostics,
    },
  } as const;
}

function classifyActorLlmProbeError(message: string): ActorSettingsCheckErrorCode {
  const normalized = message.toLowerCase();
  const networkLike =
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout") ||
    normalized.includes("abort");
  return networkLike ? "LLM_NETWORK_ERROR" : "LLM_PROVIDER_ERROR";
}

function llmSaveDiagnostics(config: ActorLlmConfig): ActorSettingsDiagnostics {
  const selected = selectedLlmConfig(config);
  return {
    provider: config.provider,
    model: selected.model,
    endpoint:
      config.provider === "google" && config.google.useVertexAi
        ? "vertex-ai"
        : hostFromUrl(selected.baseUrl),
    storage: "ema-actor-config",
  };
}

function isInvalidSettingsError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("required") ||
    normalized.includes("incomplete") ||
    normalized.includes("not supported") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid")
  );
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runActorLlmServiceCheck(
  actorId: string,
  request: ActorLlmCheckRequest,
): Promise<ActorLlmCheckResponse> {
  const startedAt = now();
  const config = request.config;
  const selected = selectedLlmConfig(config);
  const probe = await (await ensureEmaServer()).controller.settings.probeLlmConfig(
    config,
  );
  return createActorLlmCheckResponse({
    actorId,
    startedAt,
    ok: probe.ok,
    errorCode: probe.ok
      ? undefined
      : probe.unsupported
        ? "UNSUPPORTED"
        : classifyActorLlmProbeError(probe.message),
    errorDetails: probe.ok
      ? undefined
      : {
          provider: config.provider,
          model: selected.model,
          providerErrorType: probe.unsupported
            ? "unsupported"
            : "provider_probe_failed",
          providerErrorMessage: probe.message,
        },
    retryable: !probe.unsupported,
    diagnostics: {
      provider: config.provider,
      model: selected.model,
      endpoint:
        config.provider === "google" && config.google.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(selected.baseUrl),
      ...(probe.diagnostics ?? {}),
    },
  });
}

export async function saveActorLlmServiceConfig(
  actorId: string,
  request: ActorLlmSaveRequest,
): Promise<ActorLlmSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["llm"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorLlmSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    await server.controller.settings.saveLlmConfig(
      toCoreActorId(actorId),
      config,
    );
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: true,
      diagnostics: llmSaveDiagnostics(config),
    }) as ActorLlmSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: false,
      errorCode: isInvalidSettingsError(message)
        ? "INVALID_CONFIG"
        : "DATABASE_WRITE_FAILED",
      errorDetails: {
        message,
      },
      diagnostics: llmSaveDiagnostics(config),
    }) as ActorLlmSaveResponse;
  }
}

export async function saveActorWebSearchServiceConfig(
  actorId: string,
  request: ActorWebSearchSaveRequest,
): Promise<ActorWebSearchSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["webSearch"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorWebSearchSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    await server.controller.settings.saveWebSearchConfig(
      toCoreActorId(actorId),
      config,
    );
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: true,
      diagnostics: {
        enabled: config.enabled,
        storage: "ema-actor-config",
      },
    }) as ActorWebSearchSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    const invalid = isInvalidSettingsError(message);
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: false,
      errorCode: invalid ? "INVALID_CONFIG" : "DATABASE_WRITE_FAILED",
      errorDetails: {
        ...(invalid
          ? {
              issuePaths: ["webSearch.tavilyApiKey"],
              issueCodes: ["required"],
            }
          : {}),
        message,
      },
      diagnostics: {
        enabled: config.enabled,
        storage: "ema-actor-config",
      },
    }) as ActorWebSearchSaveResponse;
  }
}

export async function saveActorQqServiceConfig(
  actorId: string,
  request: ActorQQSaveRequest,
): Promise<ActorQQSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["qq"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorQQSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const savedConfig = await server.controller.channel.saveQqConnectionConfig(
      coreActorId,
      {
        wsUrl: config.wsUrl.trim(),
        accessToken: config.accessToken.trim(),
      },
    );
    const conversations =
      await server.controller.channel.listQqConversations(coreActorId);
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: true,
      diagnostics: {
        enabled: savedConfig.enabled,
        endpoint: hostFromUrl(savedConfig.wsUrl),
        conversationCount: conversations.length,
        storage: "ema-actor-config",
      },
    }) as ActorQQSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: false,
      errorCode: isInvalidSettingsError(message)
        ? "INVALID_CONFIG"
        : "DATABASE_WRITE_FAILED",
      errorDetails: {
        message,
      },
      diagnostics: {
        enabled: config.enabled,
        endpoint: hostFromUrl(config.wsUrl),
        conversationCount: config.conversations.length,
        storage: "ema-actor-config",
      },
    }) as ActorQQSaveResponse;
  }
}

export async function updateActorQqEnabledService(
  actorId: string,
  request: ActorQQEnabledUpdateRequest,
): Promise<ActorQQEnabledUpdateResponse> {
  const enabled = request.enabled === true;
  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const savedConfig = await server.controller.channel.setQqEnabled(
      coreActorId,
      enabled,
    );
    const [conversations, connectionState] = await Promise.all([
      server.controller.channel.listQqConversations(coreActorId),
      server.controller.channel.getQqConnectionState(coreActorId),
    ]);
    const config = toWebQqConfig(savedConfig, conversations);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      config,
      connection: createQqConnectionResponse(
        actorId,
        connectionState,
        "configChanged",
      ).connection,
    };
  } catch (error) {
    const message = messageFromError(error);
    let config = { ...EMPTY_QQ_CONFIG };
    let connectionState: {
      enabled: boolean;
      endpoint: string;
      transportStatus: string;
      blockedBy: unknown;
      checkedAt: number;
      retryable: boolean;
    } = {
      enabled: false,
      endpoint: "",
      transportStatus: "disconnected",
      blockedBy: "qq_disabled",
      checkedAt: Date.now(),
      retryable: false,
    };
    try {
      const server = await ensureEmaServer();
      const coreActorId = toCoreActorId(actorId);
      const [channelConfig, conversations, currentState] = await Promise.all([
        server.dbService.getActorChannelConfig(coreActorId),
        server.controller.channel.listQqConversations(coreActorId),
        server.controller.channel.getQqConnectionState(coreActorId),
      ]);
      config = toWebQqConfig(channelConfig.qq, conversations);
      connectionState = currentState;
    } catch {
      // Keep the stable error shape even when the actor has disappeared.
    }
    return {
      apiVersion: API_VERSION,
      ok: false,
      actorId,
      config,
      connection: createQqConnectionResponse(
        actorId,
        connectionState,
        "configChanged",
      ).connection,
      error: {
        code: isInvalidSettingsError(message)
          ? "INVALID_CONFIG"
          : "DATABASE_WRITE_FAILED",
        retryable: true,
        message,
        details: {
          message,
        },
      },
    };
  }
}

export async function syncActorQqServiceConnectionStatus(
  actorId: string,
  request: ActorQQConnectionStatusRequest,
): Promise<ActorQQConnectionStatusResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const reason = request.reason ?? "poll";
  const connectionState =
    reason === "retry"
      ? await server.controller.channel.restartQq(coreActorId)
      : await server.controller.channel.publishQqStatus(coreActorId);
  return createQqConnectionResponse(actorId, connectionState, reason);
}
