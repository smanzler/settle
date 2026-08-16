import { defineConfig } from "vitest/config";
import type { Env } from "./src/env";

const testEnv: Record<keyof Env, string> = {
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://auth.test",

  // Integration tests (`src/routes/scope.test.ts`, `src/lib/ledger.test.ts`)
  // exercise procedures through the module-level `db` singleton, which reads
  // this. Point it at a real database to run them; otherwise it stays a stub
  // that nothing connects to and those suites skip themselves.
  DATABASE_URL:
    process.env.INTEGRATION_DATABASE_URL ??
    "postgres://test:test@localhost:5432/test",
  PORT: "4000",
  CLIENT_ORIGIN: "http://localhost:3000",

  BUCKET_REGION: "us-east-1",
  BUCKET_ACCESS_KEY_ID: "test-access-key-id",
  BUCKET_SECRET_KEY: "test-secret-key",
  BUCKET_NAME: "test-bucket",
  BUCKET_URL: "https://cdn.example.com",

  SMTP_HOST: "test",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-pass",
  SMTP_FROM: "test@example.com",

  EXPO_ACCESS_TOKEN: "test-expo-access-token",

  PLAID_CLIENT_ID: "test-plaid-client-id",
  PLAID_SECRET: "test-plaid-secret",
  PLAID_ENV: "sandbox",
  PLAID_WEBHOOK_URL: "https://api.test/webhooks/plaid",

  ENCRYPTION_KEY:
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
};

export default defineConfig({
  test: {
    env: testEnv,
  },
});
