import { describe, expect, test, vi } from "vitest";

import type { ActorEntity } from "../../db";
import { SettingsController } from "../settings_controller";

type PersistedActor = ActorEntity & { id: number };

const validLlmConfig = {
  provider: "openai",
  openai: {
    mode: "responses",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
  },
  google: {
    model: "",
    baseUrl: "",
    apiKey: "",
    useVertexAi: false,
    project: "",
    location: "",
    credentialsFile: "",
  },
} as const;

function createFixture() {
  const actors = new Map<number, PersistedActor>([
    [1, { id: 1, roleId: 1, enabled: false }],
  ]);
  const actorDB = {
    getActor: vi.fn(async (actorId: number) => actors.get(actorId) ?? null),
    upsertActor: vi.fn(async (actor: PersistedActor) => {
      actors.set(actor.id, { ...actor });
      return actor.id;
    }),
  };
  const publishUpdated = vi.fn(async () => {});
  const server = {
    dbService: { actorDB },
    controller: {
      actor: {
        publishUpdated,
      },
    },
  };
  return {
    controller: new SettingsController(server as never),
    actors,
    actorDB,
    publishUpdated,
  };
}

describe("SettingsController", () => {
  test("saves actor LLM config without probing the provider", async () => {
    const fixture = createFixture();
    const probe = vi
      .spyOn(fixture.controller, "probeLlmConfig")
      .mockRejectedValue(new Error("probe should not run"));

    await expect(
      fixture.controller.saveLlmConfig(1, validLlmConfig),
    ).resolves.toEqual(validLlmConfig);

    expect(probe).not.toHaveBeenCalled();
    expect(fixture.actors.get(1)?.llmConfig).toEqual(validLlmConfig);
    expect(fixture.publishUpdated).toHaveBeenCalledWith(1);
  });

  test("rejects unsupported LLM configs before saving", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveLlmConfig(1, {
        ...validLlmConfig,
        openai: {
          ...validLlmConfig.openai,
          mode: "chat",
        },
      }),
    ).rejects.toThrow("OpenAI Chat Completions mode is not supported yet.");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("saves disabled web search without an ApiKey", async () => {
    const fixture = createFixture();
    const config = { enabled: false, tavilyApiKey: "" };

    await expect(
      fixture.controller.saveWebSearchConfig(1, config),
    ).resolves.toEqual(config);

    expect(fixture.actors.get(1)?.webSearchConfig).toEqual(config);
    expect(fixture.publishUpdated).toHaveBeenCalledWith(1);
  });

  test("rejects enabled web search without an ApiKey", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveWebSearchConfig(1, {
        enabled: true,
        tavilyApiKey: "  ",
      }),
    ).rejects.toThrow("Tavily ApiKey is required");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });
});
