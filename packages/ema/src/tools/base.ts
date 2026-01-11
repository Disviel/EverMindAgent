/** Tool execution result. */
export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/** Base class for all tools. */
export abstract class Tool {
  /** Tool name. */
  abstract get name(): string;

  /** Tool description. */
  abstract get description(): string;

  /** Tool parameters schema (JSON Schema format). */
  abstract get parameters(): Record<string, any>;

  /** Execute the tool with arbitrary arguments. */
  abstract execute(...args: any[]): Promise<ToolResult>;
}
