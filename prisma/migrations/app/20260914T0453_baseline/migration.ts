#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/e70196fa389e4b8a5edaf761b283314704209f87bebe3799b0a4d5e1fd696cbb/contract';
import endContract from '../../snapshots/e70196fa389e4b8a5edaf761b283314704209f87bebe3799b0a4d5e1fd696cbb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'JobStatus',
        members: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'JobStepStatus',
        members: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      }),
      this.createTable({
        schema: 'public',
        table: 'Job',
        columns: [
          col('bullJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('completedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('input', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('queuedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('result', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('startedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', '"JobStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'JobStatus' } },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'Job_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'JobStep',
        columns: [
          col('completedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('input', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('jobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('output', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('startedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', '"JobStepStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'JobStepStatus' } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'JobStep_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Job',
        index: 'Job_bullJobId_key',
        columns: ['bullJobId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'JobStep',
        index: 'JobStep_jobId_idx',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'JobStep',
        index: 'JobStep_jobId_order_idx',
        columns: ['jobId', 'order'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'JobStep',
        foreignKey: {
          name: 'JobStep_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'Job', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
