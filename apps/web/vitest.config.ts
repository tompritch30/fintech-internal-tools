import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../packages/core/test/helpers/global-setup.ts"],
    fileParallelism: false,
  },
});
