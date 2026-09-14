import { Queue, type JobsOptions, type QueueOptions } from 'bullmq'

import type { RedisConnectionOptions } from '../config/redis.js'

export const JOB_QUEUE_NAME = 'study-guide'

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1_000,
  },
  removeOnComplete: {
    age: 3_600,
  },
  removeOnFail: {
    age: 86_400,
  },
}

type JobQueueOptions = Pick<QueueOptions, 'connection' | 'defaultJobOptions'>

export function createJobQueue(connection: RedisConnectionOptions): Queue {
  return new Queue(JOB_QUEUE_NAME, {
    connection,
    defaultJobOptions,
  } satisfies JobQueueOptions)
}
