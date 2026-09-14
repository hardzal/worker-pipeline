import { describe, expect, it, vi } from 'vitest'

import { createJobRepository } from '../../src/modules/jobs/job.repository.js'

const processingJob = {
  id: 'job-1',
  _type: 'study-guide',
  status: 'PROCESSING',
  input: {
    topic: 'Model Context Protocol',
    content: 'MCP standardizes how AI applications connect to external tools and data sources.',
  },
  result: {
    title: 'Should not be exposed before completion',
  },
  error: null,
  createdAt: '2026-09-14T10:00:00',
  completedAt: null,
}

describe('job query repository', () => {
  it('lists jobs with null result while a job is incomplete', async () => {
    const all = vi.fn(async () => [processingJob])
    const db = {
      orm: {
        public: {
          Job: { all },
        },
      },
    }

    const result = await createJobRepository(db as never).listJobs()

    expect(all).toHaveBeenCalledOnce()
    expect(result).toEqual([
      {
        id: 'job-1',
        type: 'study-guide',
        status: 'PROCESSING',
        result: null,
        error: null,
        createdAt: '2026-09-14T10:00:00',
        completedAt: null,
      },
    ])
  })

  it('returns one job with its ordered pipeline steps', async () => {
    const first = vi.fn(async () => ({
      ...processingJob,
      status: 'COMPLETED',
      result: {
        title: 'MCP Study Guide',
      },
      completedAt: '2026-09-14T10:03:00',
    }))
    const all = vi.fn(async () => [
      {
        id: 'step-2',
        jobId: 'job-1',
        name: 'extract-concepts',
        order: 2,
        status: 'COMPLETED',
        input: { topic: 'MCP' },
        output: { concepts: [{ name: 'MCP', description: 'A protocol.' }] },
        error: null,
        startedAt: '2026-09-14T10:01:00',
        completedAt: '2026-09-14T10:02:00',
        durationMs: 1_000,
      },
      {
        id: 'step-1',
        jobId: 'job-1',
        name: 'analyze-material',
        order: 1,
        status: 'COMPLETED',
        input: { topic: 'MCP' },
        output: { summary: 'A protocol.' },
        error: null,
        startedAt: '2026-09-14T10:00:00',
        completedAt: '2026-09-14T10:01:00',
        durationMs: 500,
      },
    ])
    const orderBy = vi.fn(() => ({ all }))
    const where = vi.fn(() => ({ orderBy }))
    const db = {
      orm: {
        public: {
          Job: { first },
          JobStep: { where },
        },
      },
    }

    const result = await createJobRepository(db as never).getJob('job-1')

    expect(first).toHaveBeenCalledWith({ id: 'job-1' })
    expect(where).toHaveBeenCalledWith({ jobId: 'job-1' })
    expect(orderBy).toHaveBeenCalledOnce()
    expect(result).toEqual({
      id: 'job-1',
      type: 'study-guide',
      status: 'COMPLETED',
      input: processingJob.input,
      result: { title: 'MCP Study Guide' },
      error: null,
      createdAt: '2026-09-14T10:00:00',
      completedAt: '2026-09-14T10:03:00',
      steps: [
        {
          id: 'step-1',
          name: 'analyze-material',
          order: 1,
          status: 'COMPLETED',
          input: { topic: 'MCP' },
          output: { summary: 'A protocol.' },
          error: null,
          startedAt: '2026-09-14T10:00:00',
          completedAt: '2026-09-14T10:01:00',
          durationMs: 500,
        },
        {
          id: 'step-2',
          name: 'extract-concepts',
          order: 2,
          status: 'COMPLETED',
          input: { topic: 'MCP' },
          output: { concepts: [{ name: 'MCP', description: 'A protocol.' }] },
          error: null,
          startedAt: '2026-09-14T10:01:00',
          completedAt: '2026-09-14T10:02:00',
          durationMs: 1_000,
        },
      ],
    })
  })

  it('returns null when the requested job does not exist', async () => {
    const first = vi.fn(async () => null)
    const db = {
      orm: {
        public: {
          Job: { first },
        },
      },
    }

    const result = await createJobRepository(db as never).getJob('missing-job')

    expect(first).toHaveBeenCalledWith({ id: 'missing-job' })
    expect(result).toBeNull()
  })
})
