import 'dotenv/config'

import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { createApp } from '../../src/app.js'
import { parseAppEnv } from '../../src/config/env.js'
import { createPrismaClient } from '../../src/config/prisma.js'
import { createJobQueryService } from '../../src/modules/jobs/job.query.js'
import { createJobRepository } from '../../src/modules/jobs/job.repository.js'

const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === '1'

describe.skipIf(!runIntegrationTests)('Phase 10 restart persistence', () => {
  it('keeps a completed result available after recreating the API database runtime', async () => {
    const environment = parseAppEnv(process.env)
    const firstPrisma = createPrismaClient(environment.DATABASE_URL)
    const cleanupPool = new Pool({ connectionString: environment.DATABASE_URL })
    let secondPrisma: ReturnType<typeof createPrismaClient> | undefined
    let firstPrismaClosed = false
    let jobId: string | undefined

    try {
      const firstRepository = createJobRepository(firstPrisma)
      const pendingJob = await firstRepository.createPending({
        topic: 'Restart persistence integration fixture',
        content:
          'This fixture verifies that a completed study guide remains available after the API runtime is recreated.',
      })
      jobId = pendingJob.id

      const expectedResult = {
        processor: 'integration-fixture',
        title: 'Persistent Study Guide',
        summary: 'The result is stored in PostgreSQL.',
      }
      await firstRepository.markCompleted(jobId, expectedResult)

      const firstApp = createApp({
        jobQueryService: createJobQueryService(firstRepository),
      })
      const beforeRestart = await firstApp.request(`/jobs/${jobId}`)
      expect(beforeRestart.status).toBe(200)
      expect(await beforeRestart.json()).toMatchObject({
        id: jobId,
        status: 'COMPLETED',
        result: expectedResult,
      })

      await firstPrisma.close()
      firstPrismaClosed = true

      secondPrisma = createPrismaClient(environment.DATABASE_URL)
      const secondRepository = createJobRepository(secondPrisma)
      const restartedApp = createApp({
        jobQueryService: createJobQueryService(secondRepository),
      })
      const afterRestart = await restartedApp.request(`/jobs/${jobId}`)

      expect(afterRestart.status).toBe(200)
      expect(await afterRestart.json()).toMatchObject({
        id: jobId,
        status: 'COMPLETED',
        result: expectedResult,
      })
    } finally {
      if (jobId) {
        await cleanupPool.query('DELETE FROM "Job" WHERE id = $1', [jobId])
      }
      await cleanupPool.end()
      await secondPrisma?.close()
      if (!firstPrismaClosed) {
        await firstPrisma.close()
      }
    }
  }, 15_000)
})
