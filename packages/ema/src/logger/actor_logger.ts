import { LoggerBase } from "./base";
import type { LoggerMode, LoggerLevel } from "./base";

export class ActorLogger extends LoggerBase {
  constructor(mode: LoggerMode | LoggerMode[], level: LoggerLevel) {
    super("ActorLogger", mode, level);
  }
}
