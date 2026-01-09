export * from "./base";

import type { Tool } from "./base";
import { EmaReplyTool } from "./ema_reply_tool";
import { GetSkillTool } from "./get_skill_tool";
import { ExeSkillTool } from "./exe_skill_tool";
import { skillRegistry } from "../skills";

export const baseTools: Tool[] = [
  new EmaReplyTool(),
  new GetSkillTool(skillRegistry),
  new ExeSkillTool(skillRegistry),
];
