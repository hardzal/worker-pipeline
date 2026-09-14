import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../../src/app.js'
import { JobEnqueueError } from '../../src/modules/jobs/job.service.js'
import type { PipelineAgent } from '../../src/modules/pipeline/pipeline.agent.js'

const validBody = {
  topic: 'Model Context Protocol',
  content:
    'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
}

function createPipelineAgent(): PipelineAgent {
  return {
    submit: vi.fn(async () => ({ id: 'job-1', status: 'QUEUED' as const })),
  }
}

describe('POST /job', () => {
  it('returns 202 with the queued job identity', async () => {
    const pipelineAgent = createPipelineAgent()
    const response = await createApp({ pipelineAgent }).request('/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      id: 'job-1',
      status: 'QUEUED',
    })
    expect(pipelineAgent.submit).toHaveBeenCalledWith(validBody)
  })

  it('rejects invalid request bodies with 400', async () => {
    const pipelineAgent = createPipelineAgent()
    const response = await createApp({ pipelineAgent }).request('/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'AI', content: 'too short' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
    expect(pipelineAgent.submit).not.toHaveBeenCalled()
  })

  it('returns 503 when the internal job cannot be enqueued', async () => {
    const pipelineAgent: PipelineAgent = {
      submit: vi.fn(async () => {
        throw new JobEnqueueError('Redis unavailable')
      }),
    }
    const response = await createApp({ pipelineAgent }).request('/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'JOB_ENQUEUE_FAILED',
      message: 'Job could not be queued',
    })
  })

  it('does not expose the old pipeline route', async () => {
    const response = await createApp({ pipelineAgent: createPipelineAgent() }).request(
      '/pipeline',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      },
    )

    expect(response.status).toBe(404)
  })
})
