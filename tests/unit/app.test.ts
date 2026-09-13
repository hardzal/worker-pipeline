import { describe, expect, it } from 'vitest'

import { createApp } from '../../src/app.js'

describe('application health endpoint', () => {
  it('returns an ok health response', async () => {
    const response = await createApp().request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns a JSON not-found response for unknown routes', async () => {
    const response = await createApp().request('/missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'NOT_FOUND',
      message: 'Route was not found',
    })
  })
})
