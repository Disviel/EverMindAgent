import { GoogleGenAI } from "@google/genai";
import type { GoogleGenAIOptions } from "@google/genai";
import OpenAI from "openai";

import {
  DEFAULT_GOOGLE_BASE_URL,
  GlobalConfig,
  type EmbeddingConfig,
} from "../config";
import {
  buildGoogleVertexAIOptions,
  GenAI,
  GOOGLE_AI_API_VERSION,
} from "../llm/google_client";
import { FetchWithProxy } from "../llm/proxy";

export interface EmbeddingVectorProbeResult {
  values: number[];
  dimensions: number;
}

export class EmbeddingClient {
  private readonly googleClient?: GoogleGenAI;
  private readonly openaiClient?: OpenAI;
  private readonly model: string;

  constructor(private readonly config: EmbeddingConfig) {
    if (config.provider === "google") {
      this.model = config.google.model;
      const googleAIOptions: GoogleGenAIOptions = {
        apiVersion: GOOGLE_AI_API_VERSION,
        vertexai: false,
        apiKey: config.google.apiKey,
      };
      if (
        config.google.baseUrl &&
        config.google.baseUrl !== DEFAULT_GOOGLE_BASE_URL
      ) {
        googleAIOptions.httpOptions = {
          baseUrl: config.google.baseUrl,
        };
      }
      const options = config.google.useVertexAi
        ? buildGoogleVertexAIOptions(config.google)
        : googleAIOptions;
      this.googleClient = new GenAI(
        options,
        new FetchWithProxy(GlobalConfig.system.httpsProxy).createFetcher(),
      );
      return;
    }

    this.model = config.openai.model;
    this.openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
      fetch: new FetchWithProxy(GlobalConfig.system.httpsProxy).createFetcher(),
    });
  }

  async createEmbedding(
    dim: number | undefined,
    input: string,
  ): Promise<number[] | undefined> {
    const embeddingContent = input.trim();
    if (!embeddingContent) {
      return undefined;
    }

    if (this.googleClient) {
      const response = await this.googleClient.models.embedContent({
        model: this.model,
        contents: [embeddingContent],
        config: {
          taskType: "RETRIEVAL_QUERY",
          ...(dim ? { outputDimensionality: dim } : {}),
        },
      });
      return response.embeddings?.[0]?.values;
    }

    if (!this.openaiClient) {
      throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
    }
    const response = await this.openaiClient.embeddings.create({
      model: this.model,
      input: embeddingContent,
      ...(dim ? { dimensions: dim } : {}),
    });
    return response.data[0]?.embedding;
  }

  async probe(
    input = "EMA embedding probe",
  ): Promise<EmbeddingVectorProbeResult> {
    const values = await this.createEmbedding(undefined, input);
    if (!values?.length) {
      throw new Error("Embedding provider returned an empty vector.");
    }
    return {
      values,
      dimensions: values.length,
    };
  }
}
