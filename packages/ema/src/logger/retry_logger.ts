import { LoggerBase } from "./base";
import type { LoggerMode, LoggerLevel } from "./base";

/**
 * Logger for retry/backoff operations around LLM calls or tools.
 *
 * Usage: create with target modes and level.
 */
export class RetryLogger extends LoggerBase {
  /**
   * @param mode - Output targets (console/file/database).
   * @param level - Minimum log level to emit.
   */
  constructor(mode: LoggerMode | LoggerMode[], level: LoggerLevel) {
    super("RetryLogger", mode, level);
  }
}
