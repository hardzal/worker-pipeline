import { describe, expect, it } from 'vitest'

import { createRedisOptions } from '../../src/config/redis.js'

describe('createRedisOptions', () => {
  it('maps the application Redis settings to BullMQ-compatible options', () => {
    expect(
      createRedisOptions({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6381,
      }),
    ).toEqual({
      host: 'redis.internal',
      port: 6381,
      maxRetriesPerRequest: null,
    })
  })
})
