import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    environment: "node",
    // Tests share one Postgres instance (audit chain is serialized by an
    // advisory lock); run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
