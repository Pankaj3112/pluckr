import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { FieldMappings } from './types.js'
import {
  type FieldInfo,
  GENERATE_SELECTORS_SYSTEM,
  generateSelectorsPrompt,
  FIX_SELECTORS_SYSTEM,
  fixSelectorsPrompt,
} from './prompts.js'

function fieldMappingsSchema(fieldNames: string[]) {
  const shape: Record<string, z.ZodObject<any>> = {}
  for (const name of fieldNames) {
    shape[name] = z.object({
      selector: z.string(),
      transform: z.string(),
      attribute: z.string().optional(),
    })
  }
  return z.object(shape)
}

export async function generateFieldMappings(
  html: string,
  fields: FieldInfo[],
  model: LanguageModel,
): Promise<FieldMappings> {
  const fieldNames = fields.map((f) => f.name)

  const { object } = await generateObject({
    model,
    temperature: 0.2,
    schema: fieldMappingsSchema(fieldNames),
    system: GENERATE_SELECTORS_SYSTEM,
    prompt: generateSelectorsPrompt(html, fields),
  })

  return object
}

export async function fixFieldMappings(
  html: string,
  previousMappings: FieldMappings,
  errors: string,
  rawData: unknown,
  model: LanguageModel,
): Promise<FieldMappings> {
  const fieldNames = Object.keys(previousMappings)

  const { object } = await generateObject({
    model,
    temperature: 0.2,
    schema: fieldMappingsSchema(fieldNames),
    system: FIX_SELECTORS_SYSTEM,
    prompt: fixSelectorsPrompt(html, previousMappings, errors, rawData),
  })

  return object
}
