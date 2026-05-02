import "server-only";

import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
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
  toWebQqConfig,
  toWebSearchConfig,
} from "@/server/ema-adapter/settings";
import { ensureEmaServer } from "@/server/ema-server";
import { syncQqConnection } from "@/server/behaviors/qq-connect";
import { createEvent, publishEvent } from "@/server/events/bus";
import {
  getActorRecord,
  listActorSummaries,
  saveActorQqSettings,
} from "@/server/store/actors";
import { getQqConnection, qqConnectionResponse } from "@/server/store/qq";
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
  ActorQQConnectionStatusRequest,
  ActorQQConnectionStatusResponse,
  ActorQQConversation,
  ActorQQConversationCreateRequest,
  ActorQQConversationListResponse,
  ActorQQConversationMutationResponse,
  ActorQQConversationPatchRequest,
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
const QQ_SAVE_PASS_RATE = 0.86;
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

const sleep = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const shouldMockSaveSucceed = (passRate: number) =>
  cryptoRandomInt(0, 10000) < Math.round(passRate * 10000);

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

function isWsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
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
  const globalDefaults = server.controller.settings.getGlobalDefaults();
  const global = {
    llm: toWebLlmConfig(globalDefaults.llm),
    webSearch: toWebSearchConfig(globalDefaults.webSearch),
  };

  let coreActorId: number | null = null;
  try {
    coreActorId = toCoreActorId(actorId);
  } catch {
    coreActorId = null;
  }

  if (coreActorId !== null) {
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

  // Legacy mock actor ids are kept only until QQ is migrated in Step 3.7.
  const existingActor = await getActorRecord(actorId);
  if (existingActor) {
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: {
        qq: {
          ...existingActor.settings.qq,
          conversations: existingActor.settings.qq.conversations.map(
            (conversation) => ({ ...conversation }),
          ),
        },
      },
      global,
    };
  }

  return {
    apiVersion: API_VERSION,
    actorId,
    settings: {
      qq: { ...EMPTY_QQ_CONFIG, conversations: [] },
    },
    global,
  };
}

export async function buildActorQqChannelResponse(
  actorId: string,
): Promise<ActorQQChannelResponse> {
  const [settings, connection] = await Promise.all([
    buildActorSettingsResponse(actorId),
    getQqConnection(actorId),
  ]);
  const config = settings.settings.qq ?? {
    ...EMPTY_QQ_CONFIG,
    conversations: [],
  };
  return {
    apiVersion: API_VERSION,
    actorId,
    config,
    connection: connection
      ? {
          id: `qq-connection-${actorId}`,
          target: "qq",
          actorId,
          status: connection.status,
          reason: "poll",
          endpoint: connection.endpoint,
          enabled: connection.enabled,
          checkedAt: connection.checkedAt,
          retryable: connection.status === "failed",
          diagnostics: {},
        }
      : null,
  };
}

export async function listActorQqConversationsService(
  actorId: string,
): Promise<ActorQQConversationListResponse> {
  const settings = await buildActorSettingsResponse(actorId);
  return {
    apiVersion: API_VERSION,
    actorId,
    conversations: settings.settings.qq?.conversations ?? [],
  };
}

export async function createActorQqConversationService(
  actorId: string,
  request: Partial<ActorQQConversationCreateRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const actor = await getActorRecord(actorId);
  const conversation = request.conversation;
  if (!actor || !conversation) {
    return qqConversationError(actorId, "INVALID_CONFIG", "invalid conversation");
  }
  if (
    actor.settings.qq.conversations.some(
      (item) => item.type === conversation.type && item.uid === conversation.uid,
    )
  ) {
    return qqConversationError(actorId, "CONVERSATION_EXISTS", "conversation exists");
  }

  const nextConversation: ActorQQConversation = {
    id: `qq-${conversation.type}-${conversation.uid}`,
    type: conversation.type,
    uid: conversation.uid,
    name: conversation.name,
    description: conversation.description,
    allowProactive: conversation.allowProactive,
  };
  const ok = await saveActorQqSettings(actorId, {
    ...actor.settings.qq,
    conversations: [...actor.settings.qq.conversations, nextConversation],
  });
  if (ok) {
    await publishActorUpdated(actorId);
  }
  return {
    apiVersion: API_VERSION,
    ok,
    actorId,
    conversation: nextConversation,
  };
}

export async function patchActorQqConversationService(
  actorId: string,
  conversationId: string,
  request: Partial<ActorQQConversationPatchRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const actor = await getActorRecord(actorId);
  if (!actor) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }
  const index = actor.settings.qq.conversations.findIndex(
    (item) => item.id === conversationId,
  );
  if (index < 0) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  const current = actor.settings.qq.conversations[index];
  const nextConversation: ActorQQConversation = {
    ...current,
    ...(typeof request.patch?.name === "string"
      ? { name: request.patch.name }
      : {}),
    ...(typeof request.patch?.description === "string"
      ? { description: request.patch.description }
      : {}),
    ...(typeof request.patch?.allowProactive === "boolean"
      ? { allowProactive: request.patch.allowProactive }
      : {}),
  };
  const nextConversations = actor.settings.qq.conversations.map((item, itemIndex) =>
    itemIndex === index ? nextConversation : item,
  );
  const ok = await saveActorQqSettings(actorId, {
    ...actor.settings.qq,
    conversations: nextConversations,
  });
  if (ok) {
    await publishActorUpdated(actorId);
  }
  return {
    apiVersion: API_VERSION,
    ok,
    actorId,
    conversation: nextConversation,
  };
}

export async function deleteActorQqConversationService(
  actorId: string,
  conversationId: string,
): Promise<ActorQQConversationMutationResponse> {
  const actor = await getActorRecord(actorId);
  if (!actor) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }
  const nextConversations = actor.settings.qq.conversations.filter(
    (item) => item.id !== conversationId,
  );
  if (nextConversations.length === actor.settings.qq.conversations.length) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  const ok = await saveActorQqSettings(actorId, {
    ...actor.settings.qq,
    conversations: nextConversations,
  });
  if (ok) {
    await publishActorUpdated(actorId);
  }
  return {
    apiVersion: API_VERSION,
    ok,
    actorId,
    conversationId,
  };
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

async function publishActorUpdated(actorId: string) {
  const actor = (await listActorSummaries()).find((item) => item.id === actorId);
  if (!actor) {
    return;
  }

  publishEvent(
    createEvent({
      type: "actor.updated",
      actorId,
      data: { actor },
    }),
  );
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

function validateQqConfig(config: ActorQQConfig) {
  if (!config.enabled) {
    return null;
  }
  const issuePaths: string[] = [];
  if (!config.wsUrl.trim() || !isWsUrl(config.wsUrl.trim())) {
    issuePaths.push("qq.wsUrl");
  }
  if (!config.accessToken.trim()) {
    issuePaths.push("qq.accessToken");
  }
  return issuePaths.length === 0
    ? null
    : {
        issueCount: issuePaths.length,
        issuePaths,
        issueCodes: issuePaths.map(() => "required"),
      };
}

export async function saveActorQqServiceConfig(
  actorId: string,
  request: ActorQQSaveRequest,
): Promise<ActorQQSaveResponse> {
  const startedAt = now();
  await sleep(randomInt(360, 700));
  const invalid = validateQqConfig(request.config);
  const ok =
    !invalid &&
    shouldMockSaveSucceed(QQ_SAVE_PASS_RATE) &&
    (await saveActorQqSettings(actorId, request.config));

  if (ok) {
    await publishActorUpdated(actorId);
    void syncQqConnection({
      actorId,
      config: request.config,
      reason: "configChanged",
    });
  }

  return createSaveResponse({
    target: "qq",
    actorId,
    startedAt,
    ok: Boolean(ok),
    errorCode: invalid ? "INVALID_CONFIG" : "DATABASE_WRITE_FAILED",
    errorDetails: invalid ?? undefined,
    diagnostics: {
      enabled: request.config.enabled,
      endpoint: hostFromUrl(request.config.wsUrl),
      conversationCount: request.config.conversations.length,
      storage: "mock-settings-store",
    },
  }) as ActorQQSaveResponse;
}

export async function syncActorQqServiceConnectionStatus(
  actorId: string,
  request: ActorQQConnectionStatusRequest,
): Promise<ActorQQConnectionStatusResponse> {
  const actor = await getActorRecord(actorId);
  const config = actor?.settings.qq ?? {
    enabled: false,
    wsUrl: "",
    accessToken: "",
    conversations: [],
  };
  const reason = request.reason ?? "poll";
  const connection = await syncQqConnection({ actorId, config, reason });
  return qqConnectionResponse(actorId, connection, reason);
}
