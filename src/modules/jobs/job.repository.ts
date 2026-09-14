import type { PrismaClient } from '@prisma/client'

import type {
  CreateJobInput,
  JobRepository,
  PendingJob,
} from './job.types.js'

const JOB_TYPE = 'study-guide'

export function createJobRepository(prisma: PrismaClient): JobRepository {
  return {
    async createPending(input: CreateJobInput): Promise<PendingJob> {
      const job = await prisma.job.create({
        data: {
          type: JOB_TYPE,
          status: 'PENDING',
          input: {
            topic: input.topic,
            content: input.content,
          },
        },
      })

      return {
        id: job.id,
        status: 'PENDING',
      }
    },

    async markQueued(jobId: string, bullJobId: string): Promise<void> {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          bullJobId,
          queuedAt: new Date(),
          status: 'QUEUED',
        },
      })
    },

    async markFailed(jobId: string, error: string): Promise<void> {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          error,
          status: 'FAILED',
        },
      })
    },
  }
}
