import type {
  Message,
  ModelMessage,
  ToolMessage,
  UserMessage,
} from "../schema";
import type { AgentEventContent } from "../agent";

export type LoggerMode = "console" | "file" | "database";
export type LoggerLevel = "none" | "full" | "debug" | "info" | "warn" | "error";
export type LogLevel = "debug" | "info" | "warn" | "error";

const colors = {
  dim: "\u001b[2m",
  reset: "\u001b[0m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
};

const levelColor: Record<LogLevel, string> = {
  debug: colors.blue,
  info: colors.green,
  warn: colors.yellow,
  error: colors.red,
};

export interface LogRecord {
  timestamp: string;
  logger: string;
  level: LogLevel;
  message: string;
  data?: any;
}

export abstract class LoggerBase {
  readonly name: string;
  protected readonly modes: LoggerMode[];
  protected readonly level: LoggerLevel;

  constructor(
    name: string,
    mode: LoggerMode | LoggerMode[] = "console",
    level: LoggerLevel = "debug",
  ) {
    this.name = name;
    this.modes = Array.isArray(mode) ? mode : [mode];
    this.level = level;
  }

  private async logRecord(record: LogRecord): Promise<void> {
    if (!this.shouldLog(record.level)) {
      return;
    }
    await Promise.all(this.modes.map((mode) => this.dispatch(mode, record)));
  }

  public async log(
    level: LogLevel,
    message: string,
    data?: any,
  ): Promise<void> {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      logger: this.name,
      level,
      message,
      data,
    };
    await this.logRecord(record);
  }

  protected shouldLog(level: LogLevel): boolean {
    if (this.level === "none") {
      return false;
    }
    const order: Record<LoggerLevel, number> = {
      full: 0,
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
      none: 50,
    };
    return order[level] >= order[this.level];
  }

  protected async dispatch(mode: LoggerMode, record: LogRecord): Promise<void> {
    switch (mode) {
      case "console":
        await this.writeConsole(record);
        return;
      case "file":
        await this.writeFile(record);
        return;
      case "database":
        await this.writeDatabase(record);
        return;
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }

  protected writeConsole(record: LogRecord): void {
    const header =
      `${colors.dim}[${record.timestamp}]${colors.reset}` +
      `${levelColor[record.level]}[${record.level}]${colors.reset}` +
      `${colors.green}[${record.logger}]${colors.reset}` +
      `${colors.blue}${record.message}${colors.reset}`;
    console.log(header);
    if (record.data && this.level === "full") {
      console.log(record.data);
    }
  }

  protected writeFile(_record: LogRecord): void {
    throw new Error("File logger is not implemented yet.");
  }

  protected writeDatabase(_record: LogRecord): void {
    throw new Error("Database logger is not implemented yet.");
  }
}

export interface AgentLoggerInterface {
  logTokenEstimationFallbacked(
    content: AgentEventContent<"tokenEstimationFallbacked">,
  ): Promise<void>;
  logSummarizeMessagesStarted(
    content: AgentEventContent<"summarizeMessagesStarted">,
  ): Promise<void>;
  logSummarizeMessagesFinished(
    content: AgentEventContent<"summarizeMessagesFinished">,
  ): Promise<void>;
  logCreateSummaryFinished(
    content: AgentEventContent<"createSummaryFinished">,
  ): Promise<void>;
  logStepStarted(content: AgentEventContent<"stepStarted">): Promise<void>;
  logRunFinished(content: AgentEventContent<"runFinished">): Promise<void>;
  logLLMResponseReceived(
    content: AgentEventContent<"llmResponseReceived">,
  ): Promise<void>;
  logToolCallStarted(
    content: AgentEventContent<"toolCallStarted">,
  ): Promise<void>;
  logToolCallFinished(
    content: AgentEventContent<"toolCallFinished">,
  ): Promise<void>;
  logEMARplyReceived(
    content: AgentEventContent<"emaReplyReceived">,
  ): Promise<void>;
}

export interface ContextLoggerInterface {
  logFullMessages(messages: Message[]): Promise<void>;
  logUserMessage(message: UserMessage): Promise<void>;
  logToolMessage(message: ToolMessage): Promise<void>;
  logModelMessage(message: ModelMessage): Promise<void>;
}
