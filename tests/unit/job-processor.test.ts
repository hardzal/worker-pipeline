import { describe, expect, it, vi } from 'vitest'

import {
  createTemporaryJobProcessor,
  createWorkerProcessor,
} from '../../src/modules/jobs/job.processor.js'

const job = {
  id: 'job-1',
  input: {
    topic: 'Model Context Protocol',
    content:
      'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
  },
}

describe('createWorkerProcessor', () => {
  it('loads, processes, and completes a queued job', async () => {
    const calls: string[] = []
    const repository = {
      loadForProcessing: vi.fn(async () => {
        calls.push('loadForProcessing')
        return job
      }),
      markProcessing: vi.fn(async (jobId: string) => {
        calls.push(`markProcessing:${jobId}`)
      }),
      markCompleted: vi.fn(async (jobId: string) => {
        calls.push(`markCompleted:${jobId}`)
      }),
      markFailed: vi.fn(async (jobId: string) => {
        calls.push(`markFailed:${jobId}`)
      }),
    }
    const process = vi.fn(async (loadedJob: typeof job) => {
      calls.push(`process:${loadedJob.id}`)
      return {
        processor: 'temporary',
        title: `${loadedJob.input.topic} Study Guide`,
      }
    })

    const processor = createWorkerProcessor({
      process,
      repository,
    })
    const result = await processor({ data: { jobId: job.id } } as never)

    expect(result).toEqual({
      processor: 'temporary',
      title: 'Model Context Protocol Study Guide',
    })
    expect(calls).toEqual([
      'loadForProcessing',
      'markProcessing:job-1',
      'process:job-1',
      'markCompleted:job-1',
    ])
    expect(repository.markCompleted).toHaveBeenCalledWith(job.id, result)
    expect(repository.markFailed).not.toHaveBeenCalled()
  })

  it('persists a failure and rethrows the processing error', async () => {
    const repository = {
      loadForProcessing: vi.fn(async () => job),
      markProcessing: vi.fn(async () => undefined),
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    }
    const process = vi.fn(async () => {
      throw new Error('temporary processor failed')
    })

    const processor = createWorkerProcessor({
      process,
      repository,
    })

    await expect(
      processor({ data: { jobId: job.id } } as never),
    ).rejects.toThrow('temporary processor failed')
    expect(repository.markFailed).toHaveBeenCalledWith(
      job.id,
      'temporary processor failed',
    )
    expect(repository.markCompleted).not.toHaveBeenCalled()
  })

  it('marks a missing job as failed', async () => {
    const repository = {
      loadForProcessing: vi.fn(async () => null),
      markProcessing: vi.fn(async () => undefined),
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    }

    const processor = createWorkerProcessor({
      process: vi.fn(),
      repository,
    })

    await expect(
      processor({ data: { jobId: 'missing-job' } } as never),
    ).rejects.toThrow('Job missing-job was not found')
    expect(repository.markFailed).toHaveBeenCalledWith(
      'missing-job',
      'Job missing-job was not found',
    )
  })
})

describe('createTemporaryJobProcessor', () => {
  it('returns a deterministic study-guide placeholder', async () => {
    const result = await createTemporaryJobProcessor()(job)

    expect(result).toEqual({
      processor: 'temporary',
      title: 'Model Context Protocol Study Guide',
      summary:
        'Temporary processor completed a deterministic study-guide placeholder.',
      keyConcepts: ['Model Context Protocol'],
      questions: [],
    })
  })
})
