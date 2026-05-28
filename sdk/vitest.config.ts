import { defineConfig } from "vitest/config";

// One vitest config covers both packages — sdk/test/ and web/test/. web's tests
// import from web/src/ (relative) and sdk/src/project/* (via ../../sdk/...), so
// running vitest from sdk/ resolves both fine.
export default defineConfig({
  test: { include: ["test/**/*.test.ts", "../web/test/**/*.test.ts"] },
});
