import { z } from 'zod';
import { ApiError } from './errors.js';

/**
 * Parses input with a Zod schema and converts failures into a 422 whose `details`
 * map field paths to messages, so forms can highlight the exact field that is wrong.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = result.error.issues[0];
  throw ApiError.validation(first?.message ?? 'Some details are not valid.', { fields: fieldErrors });
}
