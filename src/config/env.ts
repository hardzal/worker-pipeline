import { z } from 'zod'

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? undefined : trimmed
  },
  z.string().min(1).optional(),
)

const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().trim().min(1),
  REDIS_HOST: z.string().trim().min(1).default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6380),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(1),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1).max(3_600_000).default(120_000),
  LLM_MODEL: optionalTrimmedString,
  OPENAI_API_KEY: optionalTrimmedString,
  OPENAI_API_BASE_URL: optionalTrimmedString,
})

export type AppEnv = z.infer<typeof appEnvSchema>

export function parseAppEnv(environment: Record<string, string | undefined>): AppEnv {
  const result = appEnvSchema.safeParse(environment)

  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join('.') || 'environment'),
      ),
    ]

    throw new Error(`Invalid environment variables: ${fields.join(', ')}`)
  }

  return result.data
}

export function requireAiEnv(
  environment: AppEnv,
): AppEnv & Required<Pick<AppEnv, 'LLM_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_API_BASE_URL'>> {
  const missing = (
    ['LLM_MODEL', 'OPENAI_API_KEY', 'OPENAI_API_BASE_URL'] as const
  ).filter((field) => environment[field] === undefined)

  if (missing.length > 0) {
    throw new Error(`Missing AI environment variables: ${missing.join(', ')}`)
  }

  return environment as AppEnv &
    Required<Pick<AppEnv, 'LLM_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_API_BASE_URL'>>
}
