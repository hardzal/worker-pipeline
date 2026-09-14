import { Worker, type Processor, type WorkerOptions } from 'bullmq'

import type { RedisConnectionOptions } from '../config/redis.js'

import { JOB_QUEUE_NAME } from './job.queue.js'

export type JobQueuePayload = {
  jobId: string
}

export function createJobWorker<T = unknown>(
  connection: RedisConnectionOptions,
  processor: Processor<JobQueuePayload, T>,
  options: Omit<WorkerOptions, 'connection'> = {},
): Worker<JobQueuePayload, T> {
  return new Worker<JobQueuePayload, T>(JOB_QUEUE_NAME, processor, {
    connection,
    ...options,
  })
}
