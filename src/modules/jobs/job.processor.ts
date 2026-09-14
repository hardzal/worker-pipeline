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

export class JobProcessingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI processing timed out after ${timeoutMs}ms`)
    this.name = 'JobProcessingTimeoutError'
  }
}

export function createWorkerProcessor<T extends JsonValue>(dependencies: {
  repository: JobWorkerRepository
  process: JobProcessFunction<T>
  processTimeoutMs?: number
}): Processor<JobQueuePayload, T> {
  return async (queueJob) => {
    const jobId = queueJob.data.jobId

    try {
      const job = await dependencies.repository.loadForProcessing(jobId)

      if (!job) {
        throw new Error(`Job ${jobId} was not found`)
      }

      if (job.status === 'COMPLETED') {
        return (job.result ?? null) as T
      }

      await dependencies.repository.markProcessing(job.id)
      const result = await runWithTimeout(
        dependencies.process(job),
        dependencies.processTimeoutMs,
      )
      await dependencies.repository.markCompleted(job.id, result)

      return result
    } catch (error) {
      if (isFinalAttempt(queueJob)) {
        const message = error instanceof Error ? error.message : String(error)

        try {
          await dependencies.repository.markFailed(jobId, message)
        } catch {
          // Preserve the original processing error for BullMQ retry handling.
        }
      }

      throw error
    }
  }
}

function isFinalAttempt(queueJob: {
  attemptsMade?: number
  opts?: { attempts?: number }
}): boolean {
  if (queueJob.attemptsMade === undefined || queueJob.opts?.attempts === undefined) {
    return true
  }

  return queueJob.attemptsMade + 1 >= queueJob.opts.attempts
}

function runWithTimeout<T>(operation: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) {
    return operation
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new JobProcessingTimeoutError(timeoutMs))
    }, timeoutMs)

    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
