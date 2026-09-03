import { AvatcadoError, ValidationError } from '../errors.js';
import { HttpClient, snakeToCamel, parseRateLimitHeaders } from '../http.js';
import type {
  AvatcadoResult,
  ValidateParams,
  ValidateResponse,
  VatValidationData,
  ResponseMeta,
  BatchResponseMeta,
  ValidateBatchParams,
  ValidateBatchResponse,
  BatchResult,
  BatchSummary,
  SourceStatus,
  ValidationResultMeta,
  AsyncValidateParams,
  AsyncValidateResponse,
  AsyncValidateData,
  AsyncMeta,
  AsyncBatchValidateParams,
  AsyncBatchValidateResponse,
  AsyncBatchValidateData,
} from '../types.js';

// Wire shapes after snakeToCamel. The API omits optional meta fields rather than
// sending null; the SDK normalizes every absent field to null, so responses from older
// API versions (no source fields, or an empty batch item meta) still parse.
interface WireResultMeta {
  source?: string | null;
  sourceStatus?: SourceStatus | null;
  cached?: boolean | null;
  stale?: boolean | null;
  cachedAt?: string | null;
}

interface WireEnvelopeMeta extends WireResultMeta {
  requestId?: string | null;
  mode?: 'test' | null;
  requestDurationMs?: number | null;
}

interface WireBatchItem {
  data?: VatValidationData | null;
  error?: { code?: string; message?: string; vatNumber?: string | null } | null;
  meta?: unknown;
}

/** Thrown while normalizing a malformed 2xx body; converted to a `parse_error` result by the caller. */
class MissingFieldError extends Error {
  constructor(field: string, context: string) {
    super(`Missing required field "${field}" in ${context}`);
    this.name = 'MissingFieldError';
  }
}

function requireField<T>(value: T | null | undefined, field: string, context: string): T {
  if (value === null || value === undefined) throw new MissingFieldError(field, context);
  return value;
}

function asRecord<T extends object>(value: unknown): T {
  return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as T;
}

function normalizeResultMeta(raw: unknown): ValidationResultMeta {
  const meta = asRecord<WireResultMeta>(raw);
  return {
    source: meta.source ?? null,
    sourceStatus: meta.sourceStatus ?? null,
    cached: meta.cached ?? null,
    stale: meta.stale ?? null,
    cachedAt: meta.cachedAt ?? null,
  };
}

function normalizeEnvelopeMeta(raw: unknown, context: string): BatchResponseMeta {
  const meta = asRecord<WireEnvelopeMeta>(raw);
  return {
    requestId: requireField(meta.requestId, 'request_id', context),
    mode: meta.mode ?? null,
    requestDurationMs: meta.requestDurationMs ?? null,
  };
}

function normalizeResponseMeta(raw: unknown): ResponseMeta {
  return { ...normalizeEnvelopeMeta(raw, 'ResponseMeta'), ...normalizeResultMeta(raw) };
}

function normalizeBatchResult(raw: unknown): BatchResult {
  const item = asRecord<WireBatchItem>(raw);
  if (item.data !== undefined && item.data !== null) {
    return { data: item.data, meta: normalizeResultMeta(item.meta) };
  }
  const error = requireField(item.error, 'error', 'BatchResultError');
  const meta = asRecord<{ vatNumber?: string | null }>(item.meta);
  // Newer API versions echo the normalized VAT number inside `error`; older responses
  // only carry it in the (now deprecated) `meta` object.
  const vatNumber = error.vatNumber ?? requireField(meta.vatNumber, 'vat_number', 'BatchErrorMeta');
  return {
    error: {
      code: requireField(error.code, 'code', 'BatchErrorDetail'),
      message: requireField(error.message, 'message', 'BatchErrorDetail'),
      vatNumber,
    },
    meta: { vatNumber: meta.vatNumber ?? vatNumber },
  };
}

/** Maps a normalization failure on a 2xx body to a `parse_error`; rethrows anything else. */
function toParseError(err: unknown, response: { headers: Headers; status: number }): AvatcadoError {
  if (!(err instanceof MissingFieldError)) throw err;
  return new AvatcadoError(err.message, 'parse_error', response.status, response.headers.get('x-request-id'), '');
}

export class Vat {
  constructor(private readonly http: HttpClient) {}

  async validate(params: ValidateParams): Promise<AvatcadoResult<ValidateResponse>> {
    if (!params.vatNumber || !params.vatNumber.trim()) {
      return {
        data: null,
        error: new ValidationError('vat_number is required', 'missing_parameter', 400, null, ''),
      };
    }

    const query: Record<string, string> = {
      vat_number: params.vatNumber.trim(),
    };
    if (params.requesterVatNumber) {
      query.requester_vat_number = params.requesterVatNumber;
    }
    if (params.cache === false) {
      query.cache = 'false';
    }

    const result = await this.http.request('GET', '/v1/validate', {
      query,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const payload = asRecord<{ data?: VatValidationData | null; meta?: unknown }>(snakeToCamel(result.data.json));

    try {
      return {
        data: {
          data: requireField(payload.data, 'data', 'ValidateResponse'),
          meta: normalizeResponseMeta(payload.meta),
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
  }

  async validateBatch(params: ValidateBatchParams): Promise<AvatcadoResult<ValidateBatchResponse>> {
    if (!params.vatNumbers.length) {
      return {
        data: null,
        error: new ValidationError(
          'At least one VAT number is required',
          'missing_parameter',
          400,
          null,
          '',
        ),
      };
    }
    if (params.vatNumbers.length > 50) {
      return {
        data: null,
        error: new ValidationError(
          `Batch size ${params.vatNumbers.length} exceeds maximum of 50`,
          'batch_too_large',
          400,
          null,
          '',
        ),
      };
    }

    const body: Record<string, unknown> = {
      vat_numbers: params.vatNumbers.map((v) => v.trim()),
    };
    if (params.requesterVatNumber) {
      body.requester_vat_number = params.requesterVatNumber;
    }
    if (params.cache === false) {
      body.cache = false;
    }

    const result = await this.http.request('POST', '/v1/validate/batch', {
      body,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const payload = asRecord<{
      data?: { results?: unknown[] | null; summary?: BatchSummary | null } | null;
      meta?: unknown;
    }>(snakeToCamel(result.data.json));

    try {
      const data = requireField(payload.data, 'data', 'ValidateBatchResponse');
      return {
        data: {
          data: {
            results: requireField(data.results, 'results', 'ValidateBatchResponse').map(normalizeBatchResult),
            summary: requireField(data.summary, 'summary', 'ValidateBatchResponse'),
          },
          meta: normalizeEnvelopeMeta(payload.meta, 'BatchResponseMeta'),
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
  }

  async validateAsync(params: AsyncValidateParams): Promise<AvatcadoResult<AsyncValidateResponse>> {
    if (!params.vatNumber || !params.vatNumber.trim()) {
      return {
        data: null,
        error: new ValidationError('vat_number is required', 'missing_parameter', 400, null, ''),
      };
    }

    const body: Record<string, unknown> = {
      vat_number: params.vatNumber.trim(),
    };
    if (params.requesterVatNumber) {
      body.requester_vat_number = params.requesterVatNumber;
    }
    if (params.cache === false) {
      body.cache = false;
    }

    const result = await this.http.request('POST', '/v1/validate/async', {
      body,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const transformed = snakeToCamel(result.data.json) as {
      data: AsyncValidateData;
      meta: AsyncMeta;
    };

    return {
      data: {
        data: transformed.data,
        meta: transformed.meta,
        rateLimit: parseRateLimitHeaders(result.data.headers),
      },
      error: null,
    };
  }

  async validateBatchAsync(params: AsyncBatchValidateParams): Promise<AvatcadoResult<AsyncBatchValidateResponse>> {
    if (!params.vatNumbers.length) {
      return {
        data: null,
        error: new ValidationError(
          'At least one VAT number is required',
          'missing_parameter',
          400,
          null,
          '',
        ),
      };
    }

    const body: Record<string, unknown> = {
      vat_numbers: params.vatNumbers.map((v) => v.trim()),
    };
    if (params.requesterVatNumber) {
      body.requester_vat_number = params.requesterVatNumber;
    }
    if (params.cache === false) {
      body.cache = false;
    }

    const result = await this.http.request('POST', '/v1/validate/async/batch', {
      body,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const transformed = snakeToCamel(result.data.json) as {
      data: AsyncBatchValidateData;
      meta: AsyncMeta;
    };

    return {
      data: {
        data: transformed.data,
        meta: transformed.meta,
        rateLimit: parseRateLimitHeaders(result.data.headers),
      },
      error: null,
    };
  }
}
