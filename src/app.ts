import { Hono } from 'hono'

export function createApp(): Hono {
  const app = new Hono()

  app.get('/', (context) => {
    return context.json({
      name: 'AI Pipeline Job Processing API',
      status: 'bootstrap',
    })
  })

  app.get('/health', (context) => {
    return context.json({ status: 'ok' })
  })

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
