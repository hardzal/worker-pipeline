import { describe, expect, it, vi } from 'vitest'

import {
  createJobService,
  JobEnqueueError,
} from '../../src/modules/jobs/job.service.js'
import type {
  CreateJobInput,
  JobRepository,
  JobQueue,
} from '../../src/modules/jobs/job.types.js'

const input: CreateJobInput = {
  topic: 'Model Context Protocol',
  content:
    'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
}

describe('createJobService', () => {
  it('persists a pending job, enqueues only its id, then marks it queued', async () => {
    const calls: string[] = []
    const repository: JobRepository = {
      createPending: vi.fn(async () => {
        calls.push('createPending')
        return { id: 'job-1', status: 'PENDING' }
      }),
      markQueued: vi.fn(async (jobId, bullJobId) => {
        calls.push(`markQueued:${jobId}:${bullJobId}`)
      }),
      markFailed: vi.fn(async () => {
        calls.push('markFailed')
      }),
    }
    const queue: JobQueue = {
      add: vi.fn(async (name, payload, options) => {
        calls.push(
          `add:${name}:${JSON.stringify(payload)}:${JSON.stringify(options)}`,
        )
        return { id: 'bull-job-1' }
      }),
    }

    const result = await createJobService({ repository, queue }).createJob(input)

    expect(result).toEqual({ id: 'job-1', status: 'QUEUED' })
    expect(calls).toEqual([
      'createPending',
      'add:study-guide:{"jobId":"job-1"}:{"jobId":"job-1"}',
      'markQueued:job-1:bull-job-1',
    ])
    expect(repository.createPending).toHaveBeenCalledWith(input)
  })

  it('marks the database record failed when enqueueing fails', async () => {
    const repository: JobRepository = {
      createPending: vi.fn(async () => ({ id: 'job-2', status: 'PENDING' })),
      markQueued: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    }
    const queue: JobQueue = {
      add: vi.fn(async () => {
        throw new Error('Redis unavailable')
      }),
    }

    await expect(
      createJobService({ repository, queue }).createJob(input),
    ).rejects.toBeInstanceOf(JobEnqueueError)
    expect(repository.markFailed).toHaveBeenCalledWith('job-2', 'Redis unavailable')
  })
})
