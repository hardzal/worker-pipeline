import 'dotenv/config'

import { createAiCompletionModel } from './ai/client.js'
import { createAnviaStructuredCompletion } from './ai/completion.js'
import { requireAiEnv, parseAppEnv } from './config/env.js'
import { createPrismaClient } from './config/prisma.js'
import { createRedisOptions } from './config/redis.js'
import { createJobRepository } from './modules/jobs/job.repository.js'
import { createWorkerProcessor } from './modules/jobs/job.processor.js'
import { createStudyGuideProcessor } from './pipeline/study-guide.pipeline.js'
import { JOB_QUEUE_NAME } from './queue/job.queue.js'
import { createJobWorker } from './queue/job.worker.js'

const environment = requireAiEnv(parseAppEnv(process.env))
const prisma = createPrismaClient(environment.DATABASE_URL)
const repository = createJobRepository(prisma)
const complete = createAnviaStructuredCompletion(
  createAiCompletionModel(environment),
)
const worker = createJobWorker(
  createRedisOptions(environment),
  createWorkerProcessor({
    process: createStudyGuideProcessor({ complete, stepLogger: repository }),
    repository,
  }),
  {
    concurrency: environment.WORKER_CONCURRENCY,
  },
)

worker.on('completed', (job) => {
  console.log(
    JSON.stringify({
      event: 'worker.job.completed',
      jobId: job.data.jobId,
      queueJobId: job.id,
      timestamp: new Date().toISOString(),
    }),
  )
})

worker.on('failed', (job, error) => {
  console.error(
    JSON.stringify({
      event: 'worker.job.failed',
      jobId: job?.data.jobId,
      message: error.message,
      timestamp: new Date().toISOString(),
    }),
  )
})

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log(
    JSON.stringify({
      event: 'worker.stopping',
      signal,
      timestamp: new Date().toISOString(),
    }),
  )

  try {
    await worker.close()
  } finally {
    await prisma.close()
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

console.log(
  JSON.stringify({
    concurrency: environment.WORKER_CONCURRENCY,
    event: 'worker.started',
    host: environment.REDIS_HOST,
    port: environment.REDIS_PORT,
    queue: JOB_QUEUE_NAME,
    timestamp: new Date().toISOString(),
  }),
)
