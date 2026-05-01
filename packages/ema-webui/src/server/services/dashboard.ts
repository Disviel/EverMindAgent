import "server-only";

import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import { switchActorEnabled } from "@/server/behaviors/actor-lifecycle";
import {
  toActorSummary,
  toDashboardOverviewResponse,
  toDashboardUserProfile,
} from "@/server/ema-adapter/dashboard";
import {
  DEFAULT_OWNER_USER_ID,
  toCoreActorId,
} from "@/server/ema-adapter/ids";
import { toWebSettings } from "@/server/ema-adapter/settings";
import { ensureEmaServer } from "@/server/ema-server";
import { syncQqConnection } from "@/server/behaviors/qq-connect";
import { createEvent, publishEvent } from "@/server/events/bus";
import {
  createActorRecord,
  getActorRecord,
  listActorSummaries,
  saveActorLlmSettings,
  saveActorQqSettings,
  saveActorWebSearchSettings,
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
const LLM_PROBE_PASS_RATE = 0.66;
const LLM_SAVE_PASS_RATE = 0.82;
const WEB_SEARCH_SAVE_PASS_RATE = 0.86;
const QQ_SAVE_PASS_RATE = 0.86;
const EMPTY_QQ_CONFIG: ActorQQConfig = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
  conversations: [],
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

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
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
  const existingActor = await getActorRecord(actorId);
  if (existingActor) {
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: {
        ...existingActor.settings,
        qq: {
          ...existingActor.settings.qq,
          conversations: existingActor.settings.qq.conversations.map(
            (conversation) => ({ ...conversation }),
          ),
        },
      },
    };
  }

  try {
    const coreActorId = toCoreActorId(actorId);
    const server = await ensureEmaServer();
    const [settings, qqConversations] = await Promise.all([
      server.controller.settings.getEffective(coreActorId),
      server.controller.channel.listQqConversations(coreActorId),
    ]);
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: toWebSettings(settings, qqConversations),
    };
  } catch {
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: {
        qq: { ...EMPTY_QQ_CONFIG, conversations: [] },
      },
    };
  }
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
  const actor = await createActorRecord({
    ...request,
    name: request.name.trim() || "未命名",
  });
  publishEvent(
    createEvent({
      type: "actor.created",
      actorId: actor.id,
      data: { actor },
    }),
  );
  return {
    apiVersion: API_VERSION,
    actor,
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
  const existingActor = await getActorRecord(actorId);
  if (!existingActor) {
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
        retryable: false,
        message: "actor not found",
      },
    };
  }

  const summary = await switchActorEnabled(actorId, Boolean(request.enabled));
  const status = summary?.status ?? existingActor.status;
  return {
    apiVersion: API_VERSION,
    ok: Boolean(summary),
    actorId,
    activity: {
      enabled: status !== "offline",
      status,
      switching: false,
      updatedAt: now(),
    },
  };
}

function validateActorLlmConfig(config: ActorLlmConfig): {
  code: Extract<ActorSettingsCheckErrorCode, "INVALID_CONFIG" | "UNSUPPORTED">;
  details: ActorSettingsDiagnostics;
} | null {
  if (config.provider === "openai" && config.openai.mode !== "responses") {
    return {
      code: "UNSUPPORTED",
      details: {
        issuePaths: ["llm.openai.mode"],
        issueCodes: ["unsupported"],
      },
    };
  }

  const selected = selectedLlmConfig(config);
  const issuePaths: string[] = [];
  if (!selected.model.trim() || selected.model.trim().length > 128) {
    issuePaths.push(`llm.${config.provider}.model`);
  }
  if (!selected.baseUrl.trim() || !isHttpUrl(selected.baseUrl.trim())) {
    issuePaths.push(`llm.${config.provider}.baseUrl`);
  }
  if (!selected.apiKey.trim()) {
    issuePaths.push(`llm.${config.provider}.apiKey`);
  }

  return issuePaths.length === 0
    ? null
    : {
        code: "INVALID_CONFIG",
        details: {
          issueCount: issuePaths.length,
          issuePaths,
          issueCodes: issuePaths.map(() => "required"),
        },
      };
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

function buildActorLlmProviderErrorDetails(provider: string): {
  code: ActorSettingsCheckErrorCode;
  details: ActorSettingsDiagnostics;
} {
  if (randomInt(0, 1) === 0) {
    return {
      code: "LLM_PROVIDER_ERROR",
      details: {
        provider,
        httpStatus: 401,
        providerErrorType: "authentication_error",
        providerErrorCode: "invalid_api_key",
        providerErrorMessage: "API key is invalid or expired",
      },
    };
  }
  return {
    code: "LLM_NETWORK_ERROR",
    details: {
      provider,
      networkErrorName: "LLM_PROBE_TIMEOUT",
      networkErrorMessage: "request timed out before receiving response headers",
      timeoutMs: 45000,
    },
  };
}

export async function runActorLlmServiceCheck(
  actorId: string,
  request: ActorLlmCheckRequest,
): Promise<ActorLlmCheckResponse> {
  const startedAt = now();
  const config = request.config;
  await sleep(randomInt(560, 940));

  const invalid = validateActorLlmConfig(config);
  const selected = selectedLlmConfig(config);
  if (invalid) {
    return createActorLlmCheckResponse({
      actorId,
      startedAt,
      ok: false,
      errorCode: invalid.code,
      errorDetails: invalid.details,
      retryable: invalid.code !== "UNSUPPORTED",
      diagnostics: {
        provider: config.provider,
        model: selected.model,
        endpoint: hostFromUrl(selected.baseUrl),
      },
    });
  }

  const ok = Math.random() < LLM_PROBE_PASS_RATE;
  const error = ok ? null : buildActorLlmProviderErrorDetails(config.provider);
  return createActorLlmCheckResponse({
    actorId,
    startedAt,
    ok,
    errorCode: error?.code,
    errorDetails: error?.details,
    diagnostics: {
      provider: config.provider,
      model: selected.model,
      endpoint: hostFromUrl(selected.baseUrl),
      latencyMs: randomInt(180, 1500),
    },
  });
}

export async function saveActorLlmServiceConfig(
  actorId: string,
  request: ActorLlmSaveRequest,
): Promise<ActorLlmSaveResponse> {
  const startedAt = now();
  await sleep(randomInt(420, 760));
  const invalid = validateActorLlmConfig(request.config);
  const selected = selectedLlmConfig(request.config);
  const ok =
    !invalid &&
    shouldMockSaveSucceed(LLM_SAVE_PASS_RATE) &&
    (await saveActorLlmSettings(actorId, request.config));
  if (ok) {
    await publishActorUpdated(actorId);
  }

  return createSaveResponse({
    target: "llm",
    actorId,
    startedAt,
    ok: Boolean(ok),
    errorCode: invalid ? "INVALID_CONFIG" : "DATABASE_WRITE_FAILED",
    errorDetails: invalid?.details,
    diagnostics: {
      provider: request.config.provider,
      model: selected.model,
      endpoint: hostFromUrl(selected.baseUrl),
      storage: "mock-settings-store",
    },
  }) as ActorLlmSaveResponse;
}

export async function saveActorWebSearchServiceConfig(
  actorId: string,
  request: ActorWebSearchSaveRequest,
): Promise<ActorWebSearchSaveResponse> {
  const startedAt = now();
  await sleep(randomInt(320, 640));
  const invalid =
    request.config.enabled && request.config.tavilyApiKey.trim().length === 0;
  const ok =
    !invalid &&
    shouldMockSaveSucceed(WEB_SEARCH_SAVE_PASS_RATE) &&
    (await saveActorWebSearchSettings(actorId, request.config));
  if (ok) {
    await publishActorUpdated(actorId);
  }

  return createSaveResponse({
    target: "webSearch",
    actorId,
    startedAt,
    ok: Boolean(ok),
    errorCode: invalid ? "INVALID_CONFIG" : "DATABASE_WRITE_FAILED",
    errorDetails: invalid
      ? {
          issuePaths: ["webSearch.tavilyApiKey"],
          issueCodes: ["required"],
        }
      : undefined,
    diagnostics: {
      enabled: request.config.enabled,
      storage: "mock-settings-store",
    },
  }) as ActorWebSearchSaveResponse;
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
