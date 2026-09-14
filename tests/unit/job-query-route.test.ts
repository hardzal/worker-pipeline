import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../../src/app.js'

type FakeJobQueryService = {
  listJobs(): Promise<unknown[]>
  getJob(jobId: string): Promise<unknown | null>
}

const completedJob = {
  id: 'job-1',
  type: 'study-guide',
  status: 'COMPLETED',
  result: {
    title: 'MCP Study Guide',
  },
  error: null,
  createdAt: '2026-09-14T10:00:00',
  completedAt: '2026-09-14T10:03:00',
}

const detailJob = {
  ...completedJob,
  input: {
    topic: 'Model Context Protocol',
    content: 'MCP standardizes how AI applications connect to external tools and data sources.',
  },
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
  ],
}

function createJobQueryService(): FakeJobQueryService {
  return {
    listJobs: vi.fn(async () => [completedJob]),
    getJob: vi.fn(async () => detailJob),
  }
}

describe('job query routes', () => {
  it('returns all jobs from the query service', async () => {
    const jobQueryService = createJobQueryService()

    const response = await createApp({ jobQueryService } as never).request('/jobs')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([completedJob])
    expect(jobQueryService.listJobs).toHaveBeenCalledOnce()
  })

  it('returns one job detail including pipeline steps', async () => {
    const jobQueryService = createJobQueryService()

    const response = await createApp({ jobQueryService } as never).request('/jobs/job-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(detailJob)
    expect(jobQueryService.getJob).toHaveBeenCalledWith('job-1')
  })

  it('returns 404 when the query service cannot find a job', async () => {
    const jobQueryService: FakeJobQueryService = {
      listJobs: vi.fn(async () => []),
      getJob: vi.fn(async () => null),
    }

    const response = await createApp({ jobQueryService } as never).request('/jobs/missing-job')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'JOB_NOT_FOUND',
      message: 'Job was not found',
    })
  })
})
