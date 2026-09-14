import { randomUUID } from 'node:crypto'

import {
  currentPrismaTimestamp,
  type PrismaDb,
} from '../../config/prisma.js'

import type {
  CreateJobInput,
  JobRepository,
  PendingJob,
} from './job.types.js'

const JOB_TYPE = 'study-guide'

export function createJobRepository(prisma: PrismaDb): JobRepository {
  return {
    async createPending(input: CreateJobInput): Promise<PendingJob> {
      const now = currentPrismaTimestamp()
      const job = await prisma.orm.public.Job.create({
        id: randomUUID(),
        _type: JOB_TYPE,
        status: 'PENDING',
        input: {
          topic: input.topic,
          content: input.content,
        },
        updatedAt: now,
      })

      return {
        id: job.id,
        status: 'PENDING',
      }
    },

    async markQueued(jobId: string, bullJobId: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        bullJobId,
        queuedAt: now,
        status: 'QUEUED',
        updatedAt: now,
      })
    },

    async markFailed(jobId: string, error: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        error,
        status: 'FAILED',
        updatedAt: now,
      })
    },
  }
}
