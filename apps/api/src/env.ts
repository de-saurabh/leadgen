import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Same relative location from src/ (dev) and dist/ (build): the repo root.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Signs sessions/cookies. Generate with: openssl rand -base64 32 */
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Public URL the API is reachable at (cookies, callbacks). */
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  /** Origin of the dashboard when served separately (dev: Vite on :5173). */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  /** Optional: seeds the platform admin on boot / via the seed:admin script. */
  PLATFORM_ADMIN_EMAIL: z.email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
  /** Encrypts WhatsApp access tokens at rest: 32 random bytes, base64. Generate with: openssl rand -base64 32 */
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((key) => Buffer.from(key, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
    .optional(),
  /** Verifies webhook signatures. Strongly recommended; unset only for local experiments. */
  META_APP_SECRET: z.string().min(1).optional(),
  /** The string you enter in Meta's webhook setup; echoed back during verification. */
  META_VERIFY_TOKEN: z.string().min(8).optional(),
  GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v26.0'),
  /** `test` sends only Meta's pre-approved hello_world template; `live` uses the campaign's templates. */
  WHATSAPP_TEMPLATE_MODE: z.enum(['test', 'live']).default('test'),
  /** Log outgoing WhatsApp messages instead of calling Meta, for trying the flow locally. */
  WHATSAPP_DRY_RUN: z.stringbool().default(false),
  /** When set, the API also serves the built dashboard from this directory (single-service deploys). */
  WEB_DIST_DIR: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  return parseEnv(process.env);
}
