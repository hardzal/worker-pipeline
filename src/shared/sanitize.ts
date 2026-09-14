import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

const MAX_LOG_STRING_LENGTH = 4_000
const SENSITIVE_KEY_PATTERN = /api[-_ ]?key|authorization|password|secret|token|credential/i
const SENSITIVE_TEXT_PATTERN = /(api[-_ ]?key|authorization|password|secret|token|credential)(\s*[:=]\s*)([^\s,;]+)/gi

export function sanitizeStepData(value: unknown): JsonValue {
  return sanitizeValue(value, new WeakSet<object>())
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeText(message)
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

function sanitizeText(value: string): string {
  const redacted = value.replace(SENSITIVE_TEXT_PATTERN, '$1$2[REDACTED]')

  if (redacted.length <= MAX_LOG_STRING_LENGTH) {
    return redacted
  }

  return `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`
}
