/** Tool execution result. */
export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/** Base class for all tools. */
export abstract class Tool {
  /** Returns the tool name. */
  abstract get name(): string;

  /** Returns the tool description. */
  abstract get description(): string;

  /** Returns the tool parameters schema (JSON Schema format). */
  abstract get parameters(): Record<string, any>;

  /** Executes the tool with arbitrary arguments. */
  abstract execute(...args: any[]): Promise<ToolResult>;
}
