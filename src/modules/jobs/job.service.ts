import { JOB_QUEUE_NAME } from '../../queue/job.queue.js'

import type {
  CreateJobInput,
  JobCreationResult,
  JobQueue,
  JobRepository,
} from './job.types.js'

export class JobEnqueueError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'JobEnqueueError'
  }
}

export function createJobService(dependencies: {
  repository: JobRepository
  queue: JobQueue
}) {
  return {
    async createJob(input: CreateJobInput): Promise<JobCreationResult> {
      const pendingJob = await dependencies.repository.createPending(input)

      try {
        const queuedJob = await dependencies.queue.add(
          JOB_QUEUE_NAME,
          { jobId: pendingJob.id },
          { jobId: pendingJob.id },
        )
        const bullJobId = String(queuedJob.id ?? pendingJob.id)

        await dependencies.repository.markQueued(pendingJob.id, bullJobId)

        return {
          id: pendingJob.id,
          status: 'QUEUED',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        try {
          await dependencies.repository.markFailed(pendingJob.id, message)
        } catch {
          // Preserve the enqueue failure as the externally visible error.
        }

        throw new JobEnqueueError(message, {
          cause: error,
        })
      }
    },
  }
}

export type JobService = ReturnType<typeof createJobService>
