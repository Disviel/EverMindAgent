import { LoggerBase } from "./base";
import type { LoggerMode, LoggerLevel } from "./base";

/**
 * Logger for actor-level events and messages.
 *
 * Usage: create with target modes and level, then call `logActorEvents`.
 */
export class ActorLogger extends LoggerBase {
  /**
   * @param mode - Output targets (console/file/database).
   * @param level - Minimum log level to emit.
   */
  constructor(mode: LoggerMode | LoggerMode[], level: LoggerLevel) {
    super("ActorLogger", mode, level);
  }
}
