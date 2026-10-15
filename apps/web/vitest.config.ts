import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same as packages/core: server-only throws under plain Node, so use its no-op for tests.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    name: "web",
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../packages/core/test/helpers/global-setup.ts"],
    fileParallelism: false,
  },
});
