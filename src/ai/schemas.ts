import { z } from 'zod'

export const materialAnalysisSchema = z.object({
  summary: z.string().min(1),
  audience: z.string().min(1),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
})

export type MaterialAnalysis = z.infer<typeof materialAnalysisSchema>

export const conceptExtractionSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1)
    .max(12),
})

export type ConceptExtraction = z.infer<typeof conceptExtractionSchema>

export const studyGuideSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyConcepts: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1)
    .max(12),
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .min(1)
    .max(12),
})

export type StudyGuideResult = z.infer<typeof studyGuideSchema>
