import { defineConfig } from "vitest/config";
import type { Env } from "./src/env";

const testEnv: Record<keyof Env, string> = {
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://auth.test",

  // The ledger integration suites exercise real SQL through the module-level
  // `db` singleton, which reads this. Point it at a real database to run them;
  // otherwise it stays a stub that nothing connects to and they skip themselves.
  DATABASE_URL:
    process.env.INTEGRATION_DATABASE_URL ??
    "postgres://test:test@localhost:25432/test",
  PORT: "4000",
  CLIENT_ORIGIN: "http://localhost:3000",

  SMTP_HOST: "test",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-pass",
  SMTP_FROM: "test@example.com",

  EXPO_ACCESS_TOKEN: "test-expo-access-token",
};

export default defineConfig({
  test: {
    env: testEnv,
  },
});
