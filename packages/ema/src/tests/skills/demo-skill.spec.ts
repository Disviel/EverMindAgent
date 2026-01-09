import { describe, it, expect, vi } from "vitest";
import DemoSkill from "../../skills/demo-skill/index";
import type { ToolResult } from "../../tools/base";

const format = (date: Date) => {
  const pad = (v: number) => String(v).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
      "-",
    ) +
    " " +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(
      ":",
    )
  );
};

describe("DemoSkill", () => {
  const makeSkill = () => new DemoSkill("/tmp", "demo-skill");

  it("rejects invalid payload", async () => {
    const skill = makeSkill();
    const res = (await skill.execute({ input: "" })) as ToolResult;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid demo-skill input/);
  });

  it("rejects non-command input", async () => {
    const skill = makeSkill();
    const res = (await skill.execute({ input: "hello" })) as ToolResult;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未检测到命令/);
  });

  it("handles #echo", async () => {
    const skill = makeSkill();
    const res = (await skill.execute({ input: "#echo hi" })) as ToolResult;
    expect(res.success).toBe(true);
    expect(res.content).toBe("hi");
  });

  it("rejects #echo without args", async () => {
    const skill = makeSkill();
    const res = (await skill.execute({ input: "#echo" })) as ToolResult;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/需要一个字符串参数/);
  });

  it("rejects unknown command", async () => {
    const skill = makeSkill();
    const res = (await skill.execute({ input: "#noop" })) as ToolResult;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未知命令/);
  });

  it("returns formatted time", async () => {
    const skill = makeSkill();
    vi.useFakeTimers();
    const now = new Date("2024-01-02T03:04:05Z");
    vi.setSystemTime(now);
    const res = (await skill.execute({ input: "#time" })) as ToolResult;
    expect(res.success).toBe(true);
    expect(res.content).toBe(format(new Date()));
    vi.useRealTimers();
  });
});
