import "server-only";

import {
  isEmbeddingConfigComplete,
  isLLMConfigComplete,
  isLLMConfigSupported,
  isMongoConfigComplete,
  initialDraft,
  setupSteps,
  validateSetupDraft,
  type SetupCheckPhase,
  type SetupCheckErrorCode,
  type SetupCheckTarget,
  type SetupDiagnostics,
  type SetupDraft,
  type SetupDryRunResponse,
  type SetupCommitResponse,
  type SetupServiceCheckRequest,
  type SetupServiceCheckResponse,
  type SetupStatusResponse,
  type SetupValidationIssue,
} from "@/types/setup/v1beta1";
import { commitOwnerSetup, getOwnerUser } from "@/server/store/users";
import { randomUUID } from "node:crypto";

const API_VERSION = "v1beta1" as const;
const PROBE_PASS_RATE = 0.68;

const sleep = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const shouldPassProbe = () => Math.random() < PROBE_PASS_RATE;

function now() {
  return new Date().toISOString();
}

function createCheckResponse({
  target,
  phase,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
  retryable = true,
}: {
  target: SetupCheckTarget;
  phase: SetupCheckPhase;
  startedAt: string;
  ok: boolean;
  diagnostics: SetupDiagnostics;
  errorCode?: SetupCheckErrorCode;
  errorDetails?: SetupDiagnostics;
  retryable?: boolean;
}): SetupServiceCheckResponse {
  const finishedAt = now();
  const durationMs = Math.max(
    1,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );

  return {
    apiVersion: API_VERSION,
    ok,
    check: {
      id: randomUUID(),
      target,
      phase,
      status: ok ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs,
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

function failureFromIssues(
  target: SetupCheckTarget,
  phase: SetupCheckPhase,
  startedAt: string,
  issues: SetupValidationIssue[],
): SetupServiceCheckResponse {
  return createCheckResponse({
    target,
    phase,
    startedAt,
    ok: false,
    errorCode:
      issues[0]?.code === "unsupported" ? "UNSUPPORTED" : "INVALID_CONFIG",
    retryable: issues[0]?.code !== "unsupported",
    errorDetails: {
      issueCount: issues.length,
      issuePaths: issues.map((issue) => issue.path),
      issueCodes: issues.map((issue) => issue.code),
    },
    diagnostics: {
      issueCount: issues.length,
      firstIssuePath: issues[0]?.path ?? null,
    },
  });
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value || null;
  }
}

function validationIssuesForCheck(
  target: SetupCheckTarget,
  config: SetupDraft[SetupCheckTarget] | undefined,
) {
  if (!config) {
    return [
      {
        path: target,
        code: "required",
      } satisfies SetupValidationIssue,
    ];
  }

  const draft: SetupDraft = {
    ...initialDraft,
    owner: {
      name: "Owner",
      email: "",
      qq: "10000",
    },
    [target]: config,
  };

  return validateSetupDraft(draft).filter(
    (issue) => issue.path === target || issue.path.startsWith(`${target}.`),
  );
}

function buildMongoErrorDetails(config: SetupDraft["mongo"]): {
  code: SetupCheckErrorCode;
  details: SetupDiagnostics;
} {
  if (config.kind === "memory") {
    return {
      code: "MONGO_MEMORY_START_FAILED",
      details: {
        adapter: "mongodb-memory-server",
        driverErrorName: "MongoMemoryServerStartError",
        driverErrorMessage: "binary download timed out after 30000ms",
        timeoutMs: 30000,
      },
    };
  }

  return {
    code: "MONGO_HANDSHAKE_FAILED",
    details: {
      driverErrorName: "MongoServerSelectionError",
      driverErrorMessage: "connect ECONNREFUSED 127.0.0.1:27017",
      serverSelectionTimeoutMs: 30000,
      retryWrites: true,
    },
  };
}

function buildProviderErrorDetails(
  target: Extract<SetupCheckTarget, "llm" | "embedding">,
  provider: string,
): {
  code: SetupCheckErrorCode;
  details: SetupDiagnostics;
} {
  const isAuthError = randomInt(0, 1) === 0;
  const prefix = target === "llm" ? "LLM" : "EMBEDDING";

  if (isAuthError) {
    return {
      code:
        target === "llm" ? "LLM_PROVIDER_ERROR" : "EMBEDDING_PROVIDER_ERROR",
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
    code: target === "llm" ? "LLM_NETWORK_ERROR" : "EMBEDDING_NETWORK_ERROR",
    details: {
      provider,
      networkErrorName: `${prefix}_PROBE_TIMEOUT`,
      networkErrorMessage:
        "request timed out before receiving response headers",
      timeoutMs: target === "llm" ? 45000 : 30000,
    },
  };
}

export async function runSetupServiceCheck(
  target: SetupCheckTarget,
  request: SetupServiceCheckRequest,
): Promise<SetupServiceCheckResponse> {
  const startedAt = now();
  const phase = request.phase ?? "step";

  await sleep(randomInt(560, 940));

  if (target === "mongo") {
    const config = request.config as SetupDraft["mongo"] | undefined;
    if (!config || !isMongoConfigComplete(config)) {
      return failureFromIssues(
        target,
        phase,
        startedAt,
        validationIssuesForCheck("mongo", config),
      );
    }

    const ok = shouldPassProbe();
    const error = ok ? null : buildMongoErrorDetails(config);
    return createCheckResponse({
      target,
      phase,
      startedAt,
      ok,
      errorCode: error?.code,
      errorDetails: error?.details,
      diagnostics: {
        kind: config.kind,
        database: config.dbName,
        endpoint:
          config.kind === "memory"
            ? "mongodb-memory-server"
            : hostFromUrl(config.uri),
        roundTripMs: randomInt(22, 180),
        collectionsPreview: ok ? 12 : 0,
      },
    });
  }

  if (target === "llm") {
    const config = request.config as SetupDraft["llm"] | undefined;
    if (!config || !isLLMConfigSupported(config)) {
      return failureFromIssues(target, phase, startedAt, [
        {
          path: "llm.provider",
          code: "unsupported",
        },
      ]);
    }
    if (!isLLMConfigComplete(config)) {
      return failureFromIssues(
        target,
        phase,
        startedAt,
        validationIssuesForCheck("llm", config),
      );
    }

    const ok = shouldPassProbe();
    const error = ok ? null : buildProviderErrorDetails("llm", config.provider);
    return createCheckResponse({
      target,
      phase,
      startedAt,
      ok,
      errorCode: error?.code,
      errorDetails: error?.details,
      diagnostics: {
        provider: config.provider,
        model: config.model,
        mode: config.provider === "openai" ? config.mode : "native",
        endpoint: config.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(config.baseUrl),
        credentialRef: config.useVertexAi
          ? config.projectEnvKey
          : config.envKey,
        latencyMs: randomInt(180, 1500),
      },
    });
  }

  const config = request.config as SetupDraft["embedding"] | undefined;
  if (!config || !isEmbeddingConfigComplete(config)) {
    return failureFromIssues(
      target,
      phase,
      startedAt,
      validationIssuesForCheck("embedding", config),
    );
  }

  const dimensions = config.provider === "openai" ? 3072 : 3072;
  const ok = shouldPassProbe();
  const error = ok
    ? null
    : buildProviderErrorDetails("embedding", config.provider);
  return createCheckResponse({
    target,
    phase,
    startedAt,
    ok,
    errorCode: error?.code,
    errorDetails: error?.details,
    diagnostics: {
      provider: config.provider,
      model: config.model,
      endpoint: config.useVertexAi ? "vertex-ai" : hostFromUrl(config.baseUrl),
      credentialRef: config.useVertexAi ? config.projectEnvKey : config.envKey,
      vectorDimensions: dimensions,
      latencyMs: randomInt(120, 900),
    },
  });
}

export async function buildSetupStatus(): Promise<SetupStatusResponse> {
  const owner = await getOwnerUser();
  return {
    apiVersion: API_VERSION,
    needsInitialization: !owner,
    reason: owner ? null : "CONFIG_MISSING",
    setupState: {
      status: owner ? "complete" : "required",
      configPath: "config/config.toml",
      detectedConfig: Boolean(owner),
    },
    recommendedSteps: setupSteps,
    capabilities: {
      llmProviders: ["google", "openai", "anthropic"],
      embeddingProviders: ["google", "openai"],
      unsupported: [
        {
          path: "default_llm.anthropic",
          reason:
            "Provider UI is visible but backend adapter is not wired yet.",
        },
        {
          path: "default_llm.openai.mode=chat",
          reason:
            "Chat Completions mode is reserved for a later backend adapter.",
        },
      ],
    },
  };
}

export function buildDryRunResponse(draft: SetupDraft): SetupDryRunResponse {
  const issues = validateSetupDraft(draft);
  const envKeys = Array.from(
    new Set(
      [
        draft.llm.useVertexAi ? draft.llm.projectEnvKey : draft.llm.envKey,
        draft.llm.useVertexAi ? draft.llm.locationEnvKey : null,
        draft.embedding.useVertexAi
          ? draft.embedding.projectEnvKey
          : draft.embedding.envKey,
        draft.embedding.useVertexAi ? draft.embedding.locationEnvKey : null,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  return {
    apiVersion: API_VERSION,
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "blocked",
    validation: {
      valid: issues.length === 0,
      issues,
    },
    plan: {
      configPath: "config/config.toml",
      envKeys,
      operations: [
        {
          id: "write-config",
          title: "写入 config.toml",
          status: issues.length === 0 ? "ready" : "blocked",
        },
        {
          id: "connect-mongo",
          title: "连接 MongoDB 并准备集合",
          status: isMongoConfigComplete(draft.mongo) ? "ready" : "blocked",
        },
        {
          id: "seed-owner",
          title: "初始化个人信息",
          status: draft.owner.name.trim() ? "ready" : "blocked",
        },
      ],
    },
  };
}

export async function commitSetupDraft(
  draft: SetupDraft,
): Promise<SetupCommitResponse> {
  const issues = validateSetupDraft(draft);
  if (issues.length > 0) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      error: {
        code: "INVALID_CONFIG",
        retryable: true,
        details: {
          issueCount: issues.length,
          issuePaths: issues.map((issue) => issue.path),
          issueCodes: issues.map((issue) => issue.code),
        },
      },
    };
  }

  const user = await commitOwnerSetup(draft);
  return {
    apiVersion: API_VERSION,
    ok: true,
    user: {
      id: user.id,
      name: user.name,
    },
  };
}
