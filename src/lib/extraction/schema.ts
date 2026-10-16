import { z } from "zod";

export const TaskCandidateSchema = z.object({
  title: z.string().min(1).max(240),
  courseName: z.string().max(200).nullable(),
  type: z.enum(["assignment", "lecture_topic", "quiz_exam", "lab_demo", "revision", "other"]),
  dueAt: z.string().datetime().nullable(),
  dueDateIsExplicit: z.boolean(),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  rationale: z.string().max(500),
  sourceQuote: z.string().max(600),
});

export const ExtractionResultSchema = z.object({
  candidates: z.array(TaskCandidateSchema).max(30),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
