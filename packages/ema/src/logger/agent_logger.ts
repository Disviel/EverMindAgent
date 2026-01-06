import type { AgentEventName, AgentEventContent } from "../agent";
import { LoggerBase } from "./base";
import type {
  LoggerMode,
  LoggerLevel,
  LogLevel,
  AgentLoggerInterface,
} from "./base";

export class AgentLogger extends LoggerBase implements AgentLoggerInterface {
  constructor(mode: LoggerMode | LoggerMode[], level: LoggerLevel) {
    super("AgentLogger", mode, level);
  }

  async logTokenEstimationFallbacked(
    content: AgentEventContent<"tokenEstimationFallbacked">,
  ): Promise<void> {
    const level: LogLevel = "warn";
    const message = `[tokenEstimationFallbacked] ${content.error.message}`;
    await this.log(level, message, content);
  }

  async logSummarizeMessagesStarted(
    content: AgentEventContent<"summarizeMessagesStarted">,
  ): Promise<void> {
    const level: LogLevel = "debug";
    const message = `[summarizeMessagesStarted] api: ${content.apiReportedTokens} tokens, local: ${content.localEstimatedTokens} tokens, limit: ${content.tokenLimit} tokens.`;
    await this.log(level, message, content);
  }

  async logSummarizeMessagesFinished(
    content: AgentEventContent<"summarizeMessagesFinished">,
  ): Promise<void> {
    if (content.ok) {
      const level: LogLevel = "debug";
      const message = `[summarizeMessagesFinished] msg: ${content.msg}, tokens: ${content.oldTokens} -> ${content.newTokens}`;
      await this.log(level, message, content);
    } else {
      const level: LogLevel = "warn";
      const message = `[summarizeMessagesFinished] msg: ${content.msg}`;
      await this.log(level, message, content);
    }
  }

  async logCreateSummaryFinished(
    content: AgentEventContent<"createSummaryFinished">,
  ): Promise<void> {
    const level: LogLevel = content.ok ? "debug" : "warn";
    if (content.ok) {
      const message = `[createSummaryFinished] round: ${content.roundNum}, msg: ${content.msg}, summary: ${content.summaryText}`;
      await this.log(level, message, content);
    } else {
      const level: LogLevel = "warn";
      const message = `[createSummaryFinished] round: ${content.roundNum}, msg: ${content.msg}`;
      await this.log(level, message, content);
    }
  }

  async logStepStarted(
    content: AgentEventContent<"stepStarted">,
  ): Promise<void> {
    const level: LogLevel = "debug";
    const message = `[stepStarted] ${content.stepNumber}/${content.maxSteps}`;
    await this.log(level, message, content);
  }

  async logRunFinished(
    content: AgentEventContent<"runFinished">,
  ): Promise<void> {
    const level: LogLevel = content.ok ? "debug" : "error";
    const message = `[runFinished] ${content.msg}`;
    await this.log(level, message, content);
  }

  async logLLMResponseReceived(
    content: AgentEventContent<"llmResponseReceived">,
  ): Promise<void> {
    const level: LogLevel = "debug";
    const toolCalls = content.response.message.toolCalls
      ? content.response.message.toolCalls.map((call) => call.name)
      : "";
    const message = `[llmResponseReceived] finish: ${content.response.finishReason}, tokens: ${content.response.totalTokens}, toolCalls: [${toolCalls}]`;
    await this.log(level, message, content);
  }

  async logToolCallStarted(
    content: AgentEventContent<"toolCallStarted">,
  ): Promise<void> {
    const level: LogLevel = "debug";
    const message = `[toolCallStarted] ${content.functionName}(${JSON.stringify(content.callArgs)})`;
    await this.log(level, message, content);
  }

  async logToolCallFinished(
    content: AgentEventContent<"toolCallFinished">,
  ): Promise<void> {
    const level: LogLevel = content.ok ? "debug" : "warn";
    const resultText = content.result.success
      ? content.result.content
      : content.result.error;
    const message = `[toolCallFinished] ok: ${content.ok}, ${content.functionName} -> ${resultText}`;
    await this.log(level, message, content);
  }

  async logEMARplyReceived(
    content: AgentEventContent<"emaReplyReceived">,
  ): Promise<void> {
    const level: LogLevel = "debug";
    const message = `[emaReplyReceived] [${content.reply.expression}/${content.reply.action}](${content.reply.think})${content.reply.response}`;
    await this.log(level, message, content);
  }
}
