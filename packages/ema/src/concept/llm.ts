import type { Message, LLMResponse } from "../schema";

/**
 * {@link EmaLLMClient} is a stateless client for the LLM, holding a physical network connection to the LLM.
 *
 * TODO: remove mini-agent's LLMClient definition.
 */
export interface EmaLLMClient {
  /**
   * Generates response from LLM.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of Tool objects or dicts
   * @returns LLMResponse containing the generated content, thinking, and tool calls
   */
  generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}

// TODO: definition of tools.
export type Tool = any;

/**
 * {@link Agent} is a background-running thread that communicates with the actor.
 */
export interface Agent {
  S: typeof AgentScheReqFactory;

  /**
   * Runs the agent.
   *
   * @returns void
   */
  run(scheReq: AgentScheRequest): Promise<void>;
}

interface AgentState {
  memoryBuffer: Message[];
}

type AgentScheRequest = AgentScheMessageRequest | AgentScheStateCallbackRequest;

interface AgentScheMessageRequest {
  kind: "msg";
  message: Message;
}

type AgentScheStateCallback = (state: AgentState) => void;

interface AgentScheStateCallbackRequest {
  kind: "stateCb";
  stateCallback: AgentScheStateCallback;
}

export class AgentScheReqFactory {
  static withMessage(message: Message): AgentScheMessageRequest {
    return {
      kind: "msg",
      message,
    };
  }

  static withStateCallback(
    stateCallback: AgentScheStateCallback,
  ): AgentScheStateCallbackRequest {
    return {
      kind: "stateCb",
      stateCallback,
    };
  }
}
