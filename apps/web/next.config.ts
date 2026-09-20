import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `packages/bridge` ships TypeScript source with no `dist/` (see its README:
   * the file the API serves and the file the tests run have to stay
   * byte-identical, so there is nothing to build). Next therefore has to
   * compile it as part of the app rather than treat it as a prebuilt
   * dependency — harmless under Turbopack, required under webpack (DT-098).
   */
  transpilePackages: ["bridge"],
};

export default nextConfig;
