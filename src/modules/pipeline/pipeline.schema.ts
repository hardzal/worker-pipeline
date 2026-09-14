import { z } from 'zod'

export const pipelineInputSchema = z.object({
  topic: z.string().min(3).max(200),
  content: z.string().min(50).max(50_000),
})

export type PipelineInput = z.infer<typeof pipelineInputSchema>
