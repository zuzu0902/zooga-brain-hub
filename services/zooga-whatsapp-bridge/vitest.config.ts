import { defineConfig } from "vitest/config";

// Named *.suite.ts so the parent Zooga OS app test run never picks these up;
// the bridge is a standalone service with its own dependencies.
export default defineConfig({
  test: { include: ["test/**/*.suite.ts"] },
});
