import { describe, expect, it, vi } from 'vitest'

import { createPipelineAgent } from '../../src/modules/pipeline/pipeline.agent.js'
import type { JobService } from '../../src/modules/jobs/job.service.js'

const input = {
  topic: 'Model Context Protocol',
  content:
    'Model Context Protocol standardizes how AI applications connect to external tools and data sources.',
}

describe('Pipeline Agent', () => {
  it('delegates accepted pipeline input to the internal JobService', async () => {
    const jobService: JobService = {
      createJob: vi.fn(async () => ({ id: 'job-1', status: 'QUEUED' as const })),
    }
    const pipelineAgent = createPipelineAgent({ jobService })

    const result = await pipelineAgent.submit(input)

    expect(result).toEqual({ id: 'job-1', status: 'QUEUED' })
    expect(jobService.createJob).toHaveBeenCalledWith(input)
  })
})
