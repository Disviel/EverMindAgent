import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";

import { MemFs } from "../../shared/fs";
import {
  createBootstrapConfig,
  getWorkspaceRoot,
  GlobalConfig,
  GlobalConfigError,
} from "../global_config";
import {
  createTestGlobalConfigRecord,
} from "./helpers";

describe("GlobalConfig", () => {
  const emptyEnv = () => undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    GlobalConfig.resetForTests();
  });

  test("creates dev memory bootstrap with fixed data root paths", () => {
    const bootstrap = createBootstrapConfig(
      {
        mode: "dev",
        mongoKind: "memory",
        dataRoot: ".ema-test",
      },
      emptyEnv,
    );

    const dataRoot = path.join(getWorkspaceRoot(), ".ema-test");
    expect(bootstrap.mode).toBe("dev");
    expect(bootstrap.mongo).toMatchObject({
      kind: "memory",
      dbName: "ema",
    });
    expect(bootstrap.paths).toEqual({
      dataRoot,
      logsDir: path.join(dataRoot, "logs"),
      workspaceDir: path.join(dataRoot, "workspace"),
    });
    expect(bootstrap.devBootstrap).toEqual({
      restoreDefaultSnapshot: true,
    });
  });

  test("defaults to production mode and requires mongo", () => {
    expect(() => createBootstrapConfig({}, emptyEnv)).toThrow(
      GlobalConfigError,
    );
  });

  test("requires remote mongo in production bootstrap", () => {
    expect(() => createBootstrapConfig({ mode: "prod" }, emptyEnv)).toThrow(
      GlobalConfigError,
    );

    const bootstrap = createBootstrapConfig(
      {
        mode: "prod",
        mongoUri: "mongodb://127.0.0.1:27017",
      },
      emptyEnv,
    );
    expect(bootstrap.mongo).toEqual({
      kind: "remote",
      uri: "mongodb://127.0.0.1:27017",
      dbName: "ema",
    });
    expect(bootstrap.devBootstrap).toEqual({
      restoreDefaultSnapshot: false,
    });
  });

  test("loads bootstrap without implicitly creating runtime config", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");

    const bootstrap = createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
    });
    await GlobalConfig.load(new MemFs(), { bootstrap });

    expect(GlobalConfig.system.mode).toBe("dev");
    expect(GlobalConfig.system.dataRoot).toBe(bootstrap.paths.dataRoot);
    expect(GlobalConfig.system.logsDir).toBe(bootstrap.paths.logsDir);
    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.mongo.kind).toBe("memory");
    expect(GlobalConfig.agent.workspaceDir).toBe(bootstrap.paths.workspaceDir);
    expect(GlobalConfig.hasRuntimeConfig).toBe(false);
    expect(() => GlobalConfig.defaultLlm).toThrow(
      "Database-backed GlobalConfig has not been loaded",
    );
  });

  test("loads .env proxy values for bootstrap-time system config", async () => {
    vi.stubEnv("HTTPS_PROXY", "");
    const fs = new MemFs();
    await fs.write(
      path.join(getWorkspaceRoot(), ".env"),
      "HTTPS_PROXY=http://127.0.0.1:7890\n",
    );

    await GlobalConfig.load(fs, {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });

    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
  });

  test("applies database-backed global config record", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });

    GlobalConfig.applyRecord({
      ...createTestGlobalConfigRecord(),
      system: {
        httpsProxy: "http://127.0.0.1:7890",
      },
      defaultLlm: {
        ...createTestGlobalConfigRecord().defaultLlm,
        google: {
          ...createTestGlobalConfigRecord().defaultLlm.google,
          apiKey: "db-gemini-key",
        },
      },
    });

    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.defaultLlm.google.apiKey).toBe("db-gemini-key");
  });
});
