import type {
  ActorActivityUpdateResponse,
  CreateActorRequest,
  CreateActorResponse,
  ActorLlmCheckResponse,
  ActorLlmConfig,
  ActorLlmSaveResponse,
  ActorQQConnectionStatusResponse,
  ActorQQConnectionSyncReason,
  ActorQQConfig,
  ActorQQSaveResponse,
  ActorWebSearchConfig,
  ActorWebSearchSaveResponse,
  DashboardOverviewResponse,
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

export function getDashboardOverview() {
  return fetchJson<DashboardOverviewResponse>(
    "/api/v1beta1/dashboard/overview",
    {
      method: "GET",
    },
  );
}

export function createActor(request: CreateActorRequest) {
  return fetchJson<CreateActorResponse>("/api/v1beta1/dashboard/actors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function updateActorActivity(actorId: string, enabled: boolean) {
  return fetchJson<ActorActivityUpdateResponse>(
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/activity`,
    {
      method: "POST",
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
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/llm/check`,
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
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/llm/save`,
    {
      method: "POST",
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
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/web-search/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
}

export function saveActorQqConfig(actorId: string, config: ActorQQConfig) {
  return fetchJson<ActorQQSaveResponse>(
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/qq/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
}

export function syncActorQqConnectionStatus(
  actorId: string,
  reason: ActorQQConnectionSyncReason,
) {
  return fetchJson<ActorQQConnectionStatusResponse>(
    `/api/v1beta1/dashboard/actors/${encodeURIComponent(actorId)}/qq/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
}
