import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

import {
  currentPrismaTimestamp,
  type PrismaDb,
} from '../../config/prisma.js'

import type {
  CreateJobInput,
  JobRepository,
  JobWorkerRepository,
  PendingJob,
  ProcessableJob,
} from './job.types.js'

const JOB_TYPE = 'study-guide'

export function createJobRepository(
  prisma: PrismaDb,
): JobRepository & JobWorkerRepository {
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

    async loadForProcessing(jobId: string): Promise<ProcessableJob | null> {
      const job = await prisma.orm.public.Job.first({ id: jobId })

      if (!job) {
        return null
      }

      return {
        id: job.id,
        input: parseJobInput(job.input),
      }
    },

    async markProcessing(jobId: string): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        error: null,
        startedAt: now,
        status: 'PROCESSING',
        updatedAt: now,
      })
    },

    async markCompleted(jobId: string, result: JsonValue): Promise<void> {
      const now = currentPrismaTimestamp()
      await prisma.orm.public.Job.where({ id: jobId }).update({
        completedAt: now,
        result,
        status: 'COMPLETED',
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

function parseJobInput(input: unknown): CreateJobInput {
  if (!isRecord(input)) {
    throw new Error('Job input must be a JSON object')
  }

  if (typeof input.topic !== 'string' || typeof input.content !== 'string') {
    throw new Error('Job input must contain string topic and content fields')
  }

  return {
    content: input.content,
    topic: input.topic,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
