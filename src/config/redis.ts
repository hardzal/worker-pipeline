import { Redis } from 'ioredis'

import type { AppEnv } from './env.js'

type RedisEnvironment = Pick<AppEnv, 'REDIS_HOST' | 'REDIS_PORT'>

export type RedisConnectionOptions = {
  host: string
  port: number
  maxRetriesPerRequest: null
}

export function createRedisOptions(
  environment: RedisEnvironment,
): RedisConnectionOptions {
  return {
    host: environment.REDIS_HOST,
    port: environment.REDIS_PORT,
    maxRetriesPerRequest: null,
  }
}

export function createRedisConnection(environment: RedisEnvironment): Redis {
  return new Redis(createRedisOptions(environment))
}
