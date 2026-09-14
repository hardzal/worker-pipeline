import type { JobCreationResult, CreateJobInput } from '../jobs/job.types.js'
import type { JobService } from '../jobs/job.service.js'

export type PipelineAgentInput = CreateJobInput
export type PipelineAgentResult = JobCreationResult

export type PipelineAgent = {
  submit(input: PipelineAgentInput): Promise<PipelineAgentResult>
}

export function createPipelineAgent(dependencies: {
  jobService: JobService
}): PipelineAgent {
  return {
    submit(input) {
      return dependencies.jobService.createJob(input)
    },
  }
}
