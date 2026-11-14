import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool,
  AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_AUDIENCE: z.string().optional(), // e.g. api://<client-id>
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(120),
  APPROVAL_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  MEDIUM_REQUIRES_APPROVAL_IN: z.string().default('prod'), // comma list of environment kinds
  MIN_CONFIDENCE_FOR_AUTO_ALLOW: z.coerce.number().min(0).max(1).default(0.8),
  AGENT_TIMEOUT_MS: z.coerce.number().int().default(30000),
  ARG_ENABLED: bool,
  LLM_PROVIDER: z.enum(['none', 'azure-openai']).default('none'),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = EnvSchema.parse(env);
  if (cfg.AUTH_MODE === 'dev' && cfg.NODE_ENV === 'production') {
    throw new Error('AUTH_MODE=dev is forbidden when NODE_ENV=production');
  }
  if (cfg.AUTH_MODE === 'entra' && (!cfg.ENTRA_TENANT_ID || !cfg.ENTRA_API_AUDIENCE)) {
    throw new Error('AUTH_MODE=entra requires ENTRA_TENANT_ID and ENTRA_API_AUDIENCE');
  }
  if (
    cfg.LLM_PROVIDER === 'azure-openai' &&
    !(cfg.AZURE_OPENAI_ENDPOINT && cfg.AZURE_OPENAI_DEPLOYMENT && cfg.AZURE_OPENAI_API_KEY)
  ) {
    throw new Error('LLM_PROVIDER=azure-openai requires endpoint, deployment and key');
  }
  return cfg;
}
