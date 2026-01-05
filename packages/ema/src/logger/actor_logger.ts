import type { ActorEvent } from "../actor";
import { LoggerBase } from "./base";
import type { LoggerMode, LogLevel, ActorLoggerInterface } from "./base";

export class ActorLogger extends LoggerBase implements ActorLoggerInterface {
  constructor(mode: LoggerMode | LoggerMode[], level: LogLevel) {
    super("ActorLogger", mode, level);
  }

  async logActorEvents(
    event: ActorEvent,
    level: LogLevel = "debug",
  ): Promise<void> {
    const message =
      event.type === "message"
        ? `ActorMessage: ${event.content}`
        : `ActorEvent: ${event.type}`;
    await this.logMessage({
      level,
      message,
      data: event.type === "message" ? undefined : event.content,
    });
  }
}
