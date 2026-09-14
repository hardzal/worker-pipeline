import type { Processor } from 'bullmq'
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

import type { JobQueuePayload } from '../../queue/job.worker.js'
import type {
  JobWorkerRepository,
  ProcessableJob,
} from './job.types.js'

export type JobProcessFunction<T extends JsonValue> = (
  job: ProcessableJob,
) => Promise<T>

export function createWorkerProcessor<T extends JsonValue>(dependencies: {
  repository: JobWorkerRepository
  process: JobProcessFunction<T>
}): Processor<JobQueuePayload, T> {
  return async (queueJob) => {
    const jobId = queueJob.data.jobId

    try {
      const job = await dependencies.repository.loadForProcessing(jobId)

      if (!job) {
        throw new Error(`Job ${jobId} was not found`)
      }

      await dependencies.repository.markProcessing(job.id)
      const result = await dependencies.process(job)
      await dependencies.repository.markCompleted(job.id, result)

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      try {
        await dependencies.repository.markFailed(jobId, message)
      } catch {
        // Preserve the original processing error for BullMQ retry handling.
      }

      throw error
    }
  }
}
