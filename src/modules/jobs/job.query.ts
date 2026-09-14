import type { JobDetails, JobQueryRepository, JobSummary } from './job.types.js'

export type JobQueryService = {
  listJobs(): Promise<JobSummary[]>
  getJob(jobId: string): Promise<JobDetails | null>
}

export function createJobQueryService(
  repository: JobQueryRepository,
): JobQueryService {
  return {
    listJobs() {
      return repository.listJobs()
    },
    getJob(jobId) {
      return repository.getJob(jobId)
    },
  }
}
