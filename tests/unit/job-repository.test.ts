import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'

import { createJobRepository } from '../../src/modules/jobs/job.repository.js'
import type { CreateJobInput } from '../../src/modules/jobs/job.types.js'

const input: CreateJobInput = {
  topic: 'Model Context Protocol',
  content:
    'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
}

describe('createJobRepository', () => {
  it('creates a pending job through the Prisma 8 ORM contract', async () => {
    const create = vi.fn(async (data: Record<string, unknown>) => ({
      id: data.id,
      status: data.status,
    }))
    const db = {
      orm: {
        public: {
          Job: { create },
        },
      },
    }

    const result = await createJobRepository(db as never).createPending(input)

    expect(result).toEqual({ id: expect.any(String), status: 'PENDING' })
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(create).toHaveBeenCalledWith({
      id: result.id,
      _type: 'study-guide',
      status: 'PENDING',
      input,
      updatedAt: expect.anything(),
    })
  })

  it('updates a job through the Prisma 8 where/update chain', async () => {
    const update = vi.fn(async () => undefined)
    const where = vi.fn(() => ({ update }))
    const db = {
      orm: {
        public: {
          Job: { where },
        },
      },
    }

    await createJobRepository(db as never).markQueued('job-1', 'bull-job-1')

    expect(where).toHaveBeenCalledWith({ id: 'job-1' })
    expect(update).toHaveBeenCalledWith({
      bullJobId: 'bull-job-1',
      queuedAt: expect.any(Temporal.PlainDateTime),
      status: 'QUEUED',
      updatedAt: expect.any(Temporal.PlainDateTime),
    })
  })

  it('loads a job input for worker processing', async () => {
    const first = vi.fn(async () => ({
      id: 'job-1',
      input,
    }))
    const db = {
      orm: {
        public: {
          Job: { first },
        },
      },
    }

    const result = await createJobRepository(db as never).loadForProcessing('job-1')

    expect(first).toHaveBeenCalledWith({ id: 'job-1' })
    expect(result).toEqual({ id: 'job-1', input })
  })

  it('marks a job processing and then completed with its result', async () => {
    const update = vi.fn(async () => undefined)
    const where = vi.fn(() => ({ update }))
    const db = {
      orm: {
        public: {
          Job: { where },
        },
      },
    }
    const repository = createJobRepository(db as never)

    await repository.markProcessing('job-1')
    await repository.markCompleted('job-1', {
      processor: 'test',
      title: 'Study Guide',
    })

    expect(where).toHaveBeenNthCalledWith(1, { id: 'job-1' })
    expect(where).toHaveBeenNthCalledWith(2, { id: 'job-1' })
    expect(update).toHaveBeenNthCalledWith(1, {
      error: null,
      startedAt: expect.any(Temporal.PlainDateTime),
      status: 'PROCESSING',
      updatedAt: expect.any(Temporal.PlainDateTime),
    })
    expect(update).toHaveBeenNthCalledWith(2, {
      completedAt: expect.any(Temporal.PlainDateTime),
      result: {
        processor: 'test',
        title: 'Study Guide',
      },
      status: 'COMPLETED',
      updatedAt: expect.any(Temporal.PlainDateTime),
    })
  })

  it('persists the JobStep lifecycle with sanitized data supplied by the logger', async () => {
    const create = vi.fn(async (data: Record<string, unknown>) => ({ id: data.id }))
    const update = vi.fn(async () => undefined)
    const where = vi.fn(() => ({ update }))
    const db = {
      orm: {
        public: {
          JobStep: { create, where },
        },
      },
    }
    const repository = createJobRepository(db as never)

    const step = await repository.createStep('job-1', 'analyze-material', 1, {
      topic: 'MCP',
    })
    await repository.markStepProcessing(step.id)
    await repository.markStepCompleted(step.id, { summary: 'done' }, 12)
    await repository.markStepFailed(step.id, 'provider failed', 15)

    expect(step).toEqual({ id: expect.any(String) })
    expect(create).toHaveBeenCalledWith({
      id: step.id,
      jobId: 'job-1',
      name: 'analyze-material',
      order: 1,
      status: 'PENDING',
      input: { topic: 'MCP' },
    })
    expect(where).toHaveBeenNthCalledWith(1, { id: step.id })
    expect(where).toHaveBeenNthCalledWith(2, { id: step.id })
    expect(where).toHaveBeenNthCalledWith(3, { id: step.id })
    expect(update).toHaveBeenNthCalledWith(1, {
      startedAt: expect.any(Temporal.PlainDateTime),
      status: 'PROCESSING',
    })
    expect(update).toHaveBeenNthCalledWith(2, {
      completedAt: expect.any(Temporal.PlainDateTime),
      durationMs: 12,
      output: { summary: 'done' },
      status: 'COMPLETED',
    })
    expect(update).toHaveBeenNthCalledWith(3, {
      completedAt: expect.any(Temporal.PlainDateTime),
      durationMs: 15,
      error: 'provider failed',
      status: 'FAILED',
    })
  })
})
