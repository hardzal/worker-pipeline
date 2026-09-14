import type { Hono } from 'hono'

import type { JobQueryService } from './job.query.js'

export function registerJobQueryRoutes(
  app: Hono,
  jobQueryService: JobQueryService,
): void {
  app.get('/jobs', async (context) => {
    const jobs = await jobQueryService.listJobs()
    return context.json(jobs)
  })

  app.get('/jobs/:id', async (context) => {
    const job = await jobQueryService.getJob(context.req.param('id'))

    if (!job) {
      return context.json(
        {
          error: 'JOB_NOT_FOUND',
          message: 'Job was not found',
        },
        404,
      )
    }

    return context.json(job)
  })
}
