import 'dotenv/config'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { parseAppEnv } from './config/env.js'

const environment = parseAppEnv(process.env)
const app = createApp()

const server = serve(
  {
    fetch: app.fetch,
    hostname: environment.HOST,
    port: environment.PORT,
  },
  (info) => {
    console.log(
      JSON.stringify({
        event: 'api.started',
        host: environment.HOST,
        port: info.port,
        timestamp: new Date().toISOString(),
      }),
    )
  },
)

function shutdown(signal: NodeJS.Signals): void {
  console.log(
    JSON.stringify({
      event: 'api.stopping',
      signal,
      timestamp: new Date().toISOString(),
    }),
  )

  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
