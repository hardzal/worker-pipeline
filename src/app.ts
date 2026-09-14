import { Hono } from 'hono'

import { registerPipelineRoutes } from './modules/pipeline/pipeline.route.js'
import type { PipelineAgent } from './modules/pipeline/pipeline.agent.js'

export type AppDependencies = {
  pipelineAgent?: PipelineAgent
}

export function createApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono()

  app.get('/', (context) => {
    return context.json({
      name: 'AI Pipeline Agent',
      status: 'bootstrap',
    })
  })

  app.get('/health', (context) => {
    return context.json({ status: 'ok' })
  })

  if (dependencies.pipelineAgent) {
    registerPipelineRoutes(app, dependencies.pipelineAgent)
  }

  app.notFound((context) => {
    return context.json(
      {
        error: 'NOT_FOUND',
        message: 'Route was not found',
      },
      404,
    )
  })

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        event: 'http.unhandled_error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
    )

    return context.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      500,
    )
  })

  return app
}
