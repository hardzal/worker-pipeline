import 'dotenv/config'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { parseAppEnv } from './config/env.js'
import { createPipelineRuntime } from './config/runtime.js'

const environment = parseAppEnv(process.env)
const runtime = createPipelineRuntime(environment)
const app = createApp({ pipelineAgent: runtime.pipelineAgent })

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

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log(
    JSON.stringify({
      event: 'api.stopping',
      signal,
      timestamp: new Date().toISOString(),
    }),
  )

  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        console.error(error)
        process.exitCode = 1
      }

      resolve()
    })
  })

  await runtime.close()
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
