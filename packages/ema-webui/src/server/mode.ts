import "server-only";

export function getBackendMode() {
  return process.env.EMA_BACKEND === "real" ? "real" : "mock";
}
