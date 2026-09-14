import { describe, expect, it } from 'vitest'

import { parseAppEnv } from '../../src/config/env.js'

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55433/ai_pipeline',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6380',
}

describe('parseAppEnv', () => {
  it('applies safe local defaults', () => {
    const environment = parseAppEnv(validEnvironment)

    expect(environment).toMatchObject({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3000,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6380,
      WORKER_CONCURRENCY: 1,
      AI_TIMEOUT_MS: 120_000,
    })
  })

  it('treats blank AI settings as missing', () => {
    const environment = parseAppEnv({
      ...validEnvironment,
      LLM_MODEL: '   ',
      OPENAI_API_KEY: '',
      OPENAI_API_BASE_URL: ' ',
    })

    expect(environment.LLM_MODEL).toBeUndefined()
    expect(environment.OPENAI_API_KEY).toBeUndefined()
    expect(environment.OPENAI_API_BASE_URL).toBeUndefined()
  })

  it('rejects an invalid port without leaking environment values', () => {
    expect(() =>
      parseAppEnv({
        ...validEnvironment,
        PORT: 'not-a-port',
        OPENAI_API_KEY: 'must-not-appear',
      }),
    ).toThrowError(/PORT/)

    try {
      parseAppEnv({
        ...validEnvironment,
        PORT: 'not-a-port',
        OPENAI_API_KEY: 'must-not-appear',
      })
    } catch (error) {
      expect(String(error)).not.toContain('must-not-appear')
    }
  })
})
