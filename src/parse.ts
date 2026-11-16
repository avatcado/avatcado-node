import { AvatcadoError } from './errors.js';

/** Thrown while normalizing a malformed 2xx body; converted to a `parse_error` result by the caller. */
export class MissingFieldError extends Error {
  constructor(field: string, context: string) {
    super(`Missing required field "${field}" in ${context}`);
    this.name = 'MissingFieldError';
  }
}

export function requireField<T>(value: T | null | undefined, field: string, context: string): T {
  if (value === null || value === undefined) throw new MissingFieldError(field, context);
  return value;
}

export function requireArray<T>(value: unknown, field: string, context: string): T[] {
  if (!Array.isArray(value)) throw new MissingFieldError(field, context);
  return value as T[];
}

/** The value when it is a plain object, otherwise an empty object, so field reads never throw. */
export function asRecord<T extends object>(value: unknown): T {
  return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as T;
}

/** Maps a normalization failure on a 2xx body to a `parse_error`; rethrows anything else. */
export function toParseError(err: unknown, response: { headers: Headers; status: number }): AvatcadoError {
  if (!(err instanceof MissingFieldError)) throw err;
  return new AvatcadoError(err.message, 'parse_error', response.status, response.headers.get('x-request-id'), '');
}
