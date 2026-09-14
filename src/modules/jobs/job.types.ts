import type { JobsOptions } from 'bullmq'

export type CreateJobInput = {
  topic: string
  content: string
}

export type JobCreationResult = {
  id: string
  status: 'QUEUED'
}

export type PendingJob = {
  id: string
  status: 'PENDING'
}

export type JobQueuePayload = {
  jobId: string
}

export interface JobRepository {
  createPending(input: CreateJobInput): Promise<PendingJob>
  markQueued(jobId: string, bullJobId: string): Promise<void>
  markFailed(jobId: string, error: string): Promise<void>
}

export interface JobQueue {
  add(
    name: string,
    payload: JobQueuePayload,
    options: Pick<JobsOptions, 'jobId'>,
  ): Promise<{ id?: string | number | null }>
}
