import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

export type StepLogger = {
  createStep(
    jobId: string,
    name: string,
    order: number,
    input: JsonValue,
  ): Promise<{ id: string }>
  markStepProcessing(stepId: string): Promise<void>
  markStepCompleted(stepId: string, output: JsonValue, durationMs: number): Promise<void>
  markStepFailed(stepId: string, error: string, durationMs: number): Promise<void>
}

export type ExecuteStepOptions<TInput, TOutput> = {
  jobId: string
  name: string
  order: number
  input: TInput
  run: () => Promise<TOutput>
}

const MAX_LOG_STRING_LENGTH = 4_000
const SENSITIVE_KEY_PATTERN = /api[-_ ]?key|authorization|password|secret|token|credential/i
const SENSITIVE_TEXT_PATTERN = /(api[-_ ]?key|authorization|password|secret|token|credential)(\s*[:=]\s*)([^\s,;]+)/gi

export async function executeStep<TInput, TOutput>(
  logger: StepLogger,
  options: ExecuteStepOptions<TInput, TOutput>,
): Promise<TOutput> {
  const step = await logger.createStep(
    options.jobId,
    options.name,
    options.order,
    sanitizeStepData(options.input),
  )
  const startedAt = Date.now()

  try {
    await logger.markStepProcessing(step.id)
    const output = await options.run()

    await logger.markStepCompleted(
      step.id,
      sanitizeStepData(output),
      elapsedMilliseconds(startedAt),
    )

    return output
  } catch (error) {
    try {
      await logger.markStepFailed(
        step.id,
        sanitizeErrorMessage(error),
        elapsedMilliseconds(startedAt),
      )
    } catch {
      // Preserve the original pipeline failure if step-log persistence also fails.
    }

    throw error
  }
}

export function sanitizeStepData(value: unknown): JsonValue {
  return sanitizeValue(value, new WeakSet<object>())
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    return sanitizeText(value)
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'bigint') {
    return String(value)
  }

  if (typeof value !== 'object') {
    return sanitizeText(String(value))
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen))
  }

  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeValue(item, seen)
  }

  return result
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeText(message)
}

function sanitizeText(value: string): string {
  const redacted = value.replace(SENSITIVE_TEXT_PATTERN, '$1$2[REDACTED]')

  if (redacted.length <= MAX_LOG_STRING_LENGTH) {
    return redacted
  }

  return `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}
