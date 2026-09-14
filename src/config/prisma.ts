import 'temporal-polyfill/full/global'

import postgres from '@prisma/orm-postgres/runtime'
import { Temporal } from 'temporal-polyfill'

import type { Contract } from '../../generated/prisma/contract.js'
import contractJson from '../../generated/prisma/contract.json' with { type: 'json' }

export function createPrismaClient(databaseUrl: string) {
  return postgres<Contract>({
    url: databaseUrl,
    contractJson,
  })
}

export type PrismaDb = ReturnType<typeof createPrismaClient>

export function currentPrismaTimestamp(): Temporal.PlainDateTime {
  return Temporal.Now.instant().toZonedDateTimeISO('UTC').toPlainDateTime()
}
