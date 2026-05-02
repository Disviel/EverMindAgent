import type {
  ActorActivityUpdateResponse,
  CreateActorRequest,
  CreateActorResponse,
  ActorLlmCheckResponse,
  ActorLlmConfig,
  ActorLlmSaveResponse,
  ActorListResponse,
  ActorQQConnectionStatusResponse,
  ActorQQConnectionSyncReason,
  ActorQQConfig,
  ActorQQConversationCreateRequest,
  ActorQQEnabledUpdateResponse,
  ActorQQConversationMutationResponse,
  ActorQQConversationPatchRequest,
  ActorQQSaveResponse,
  ActorSettingsResponse,
  ActorWebSearchConfig,
  ActorWebSearchSaveResponse,
  DashboardOverviewResponse,
  OwnerResponse,
} from "@/types/dashboard/v1beta1";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      extractMessage(payload) || `${response.status} ${response.statusText}`,
    );
  }

  return payload as T;
}

function extractMessage(payload: unknown) {
  if (typeof payload === "string") {
    return payload.trim();
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") {
    return record.message;
  }
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>).message === "string"
  ) {
    return (record.error as Record<string, string>).message;
  }
  return null;
}

export async function getDashboardOverview() {
  const [owner, actors] = await Promise.all([
    fetchJson<OwnerResponse>("/api/v1beta1/owner", {
      method: "GET",
    }),
    fetchJson<ActorListResponse>("/api/v1beta1/actors", {
      method: "GET",
    }),
  ]);
  return {
    apiVersion: "v1beta1",
    generatedAt: actors.generatedAt,
    user: owner.user,
    actors: actors.actors,
  } satisfies DashboardOverviewResponse;
}

export function createActor(request: CreateActorRequest) {
  return fetchJson<CreateActorResponse>("/api/v1beta1/actors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function getActorSettings(actorId: string) {
  return fetchJson<ActorSettingsResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/settings`,
    {
      method: "GET",
    },
  );
}

export function updateActorActivity(actorId: string, enabled: boolean) {
  return fetchJson<ActorActivityUpdateResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/runtime`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
}

export function runActorLlmCheck(
  actorId: string,
  config: ActorLlmConfig,
  attempt = 0,
) {
  return fetchJson<ActorLlmCheckResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/settings/llm/probes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attempt,
        config,
      }),
    },
  );
}

export function saveActorLlmConfig(actorId: string, config: ActorLlmConfig) {
  return fetchJson<ActorLlmSaveResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/settings/llm`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
}

export function saveActorWebSearchConfig(
  actorId: string,
  config: ActorWebSearchConfig,
) {
  return fetchJson<ActorWebSearchSaveResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/settings/web-search`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
}

export function saveActorQqConfig(actorId: string, config: ActorQQConfig) {
  return fetchJson<ActorQQSaveResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
}

export function updateActorQqEnabled(actorId: string, enabled: boolean) {
  return fetchJson<ActorQQEnabledUpdateResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
}

export function createActorQqConversation(
  actorId: string,
  conversation: ActorQQConversationCreateRequest["conversation"],
) {
  return fetchJson<ActorQQConversationMutationResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq/conversations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation }),
    },
  );
}

export function patchActorQqConversation(
  actorId: string,
  conversationId: string,
  patch: ActorQQConversationPatchRequest["patch"],
) {
  return fetchJson<ActorQQConversationMutationResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    },
  );
}

export function deleteActorQqConversation(
  actorId: string,
  conversationId: string,
) {
  return fetchJson<ActorQQConversationMutationResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
    },
  );
}

export function syncActorQqConnectionStatus(
  actorId: string,
  reason: ActorQQConnectionSyncReason,
) {
  return fetchJson<ActorQQConnectionStatusResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/channels/qq/connection-syncs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
}
