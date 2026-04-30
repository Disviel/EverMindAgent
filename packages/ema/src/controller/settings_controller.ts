import { GlobalConfig, type LLMConfig, type WebSearchConfig } from "../config";
import type { Server } from "../server";
import type { EffectiveActorSettings, LlmProbeResult } from "./types";

export class SettingsController {
  constructor(private readonly server: Server) {}

  async getEffective(actorId: number): Promise<EffectiveActorSettings> {
    return {
      llm: await this.server.dbService.getActorLLMConfig(actorId),
      webSearch: await this.server.dbService.getActorWebSearchConfig(actorId),
      channel: await this.server.dbService.getActorChannelConfig(actorId),
    };
  }

  async probeLlmConfig(config: LLMConfig): Promise<LlmProbeResult> {
    if (config.provider === "openai" && config.openai.mode !== "responses") {
      return {
        ok: false,
        unsupported: true,
        message: "OpenAI Chat Completions mode is not supported yet.",
      };
    }
    const selected = config.provider === "openai" ? config.openai : config.google;
    if (!selected.model.trim() || !selected.baseUrl.trim() || !selected.apiKey.trim()) {
      return {
        ok: false,
        unsupported: false,
        message: "LLM config is incomplete.",
      };
    }
    return {
      ok: true,
      unsupported: false,
      message: "ok",
    };
  }

  async saveLlmConfig(actorId: number, config: LLMConfig): Promise<LLMConfig> {
    const probe = await this.probeLlmConfig(config);
    if (!probe.ok) {
      throw new Error(probe.message);
    }
    const actor = await this.requireActor(actorId);
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      llmConfig: config,
    });
    await this.server.controller.actor.publishUpdated(actorId);
    return config;
  }

  async saveWebSearchConfig(
    actorId: number,
    config: WebSearchConfig,
  ): Promise<WebSearchConfig> {
    if (config.enabled && !config.tavilyApiKey.trim()) {
      throw new Error("Tavily ApiKey is required when web search is enabled.");
    }
    const actor = await this.requireActor(actorId);
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      webSearchConfig: config,
    });
    await this.server.controller.actor.publishUpdated(actorId);
    return config;
  }

  getGlobalDefaults(): {
    llm: LLMConfig;
    webSearch: WebSearchConfig;
  } {
    return {
      llm: GlobalConfig.defaultLlm,
      webSearch: GlobalConfig.defaultWebSearch,
    };
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as typeof actor & { id: number };
  }
}
