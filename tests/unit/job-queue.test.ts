import { describe, expect, it } from 'vitest'

import {
  JOB_QUEUE_NAME,
  defaultJobOptions,
} from '../../src/queue/job.queue.js'

describe('job queue configuration', () => {
  it('uses the study-guide queue with durable retry defaults', () => {
    expect(JOB_QUEUE_NAME).toBe('study-guide')
    expect(defaultJobOptions).toEqual({
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
    })
  })
})
