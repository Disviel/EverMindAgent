import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(`${process.cwd()}/../../`);

const nextConfig: NextConfig = {
  transpilePackages: ["ema"],
  serverExternalPackages: [
    "@lancedb/lancedb",
    "mongodb",
    "mongodb-agenda",
    "pino",
    "pino-pretty",
    "thread-stream",
  ],
};

export default nextConfig;
