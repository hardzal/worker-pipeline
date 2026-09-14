import type { AppEnv } from './env.js'
import { createPrismaClient } from './prisma.js'
import { createRedisOptions } from './redis.js'
import { createJobRepository } from '../modules/jobs/job.repository.js'
import { createJobService } from '../modules/jobs/job.service.js'
import {
  createPipelineAgent,
  type PipelineAgent,
} from '../modules/pipeline/pipeline.agent.js'
import { createJobQueue } from '../queue/job.queue.js'

export type PipelineRuntime = {
  pipelineAgent: PipelineAgent
  close(): Promise<void>
}

export function createPipelineRuntime(environment: AppEnv): PipelineRuntime {
  const prisma = createPrismaClient(environment.DATABASE_URL)
  const queue = createJobQueue(createRedisOptions(environment))
  const jobService = createJobService({
    queue,
    repository: createJobRepository(prisma),
  })

  return {
    pipelineAgent: createPipelineAgent({ jobService }),
    async close(): Promise<void> {
      await Promise.allSettled([queue.close(), prisma.close()])
    },
  }
}
