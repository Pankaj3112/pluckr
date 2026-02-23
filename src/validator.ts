import { type ZodSchema, type ZodError } from 'zod'

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string; rawData: unknown }

function formatZodErrors(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return `${path}: ${issue.message} (code: ${issue.code})`
    })
    .join('; ')
}

export function validate<T>(
  schema: ZodSchema<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data }
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
    rawData: data,
  }
}
