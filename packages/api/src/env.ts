import { z } from "zod";
import "dotenv/config";

export const envSchema = z.object({
  BETTER_AUTH_SECRET: z.string(),
  BETTER_AUTH_URL: z.string(),

  DATABASE_URL: z.string(),
  PORT: z.coerce.number().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),

  BUCKET_REGION: z.string(),
  BUCKET_ACCESS_KEY_ID: z.string(),
  BUCKET_SECRET_KEY: z.string(),
  BUCKET_NAME: z.string(),
  BUCKET_URL: z.string(),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Budget <noreply@budget.local>"),

  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
