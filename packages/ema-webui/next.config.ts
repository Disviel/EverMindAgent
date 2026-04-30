import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(`${process.cwd()}/../../`);

const nextConfig: NextConfig = {
  /* Mock-only web UI. Do not import or transpile the ema backend package here. */
};

export default nextConfig;
