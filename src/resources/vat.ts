import { ValidationError } from '../errors.js';
import { HttpClient, snakeToCamel, parseRateLimitHeaders } from '../http.js';
import { asRecord, requireArray, requireField, toParseError } from '../parse.js';
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
  ValidationFlags,
  ValidationResultMeta,
  AsyncValidateParams,
  AsyncValidateResponse,
  AsyncValidateData,
  AsyncMeta,
  AsyncBatchValidateParams,
  AsyncBatchValidateResponse,
  AsyncBatchValidateData,
  AsyncRejectedItem,
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

/** `cache` and `fallback` as the API should receive them: only when the caller set a boolean. */
function flags(params: ValidationFlags): { cache?: boolean; fallback?: boolean } {
  const out: { cache?: boolean; fallback?: boolean } = {};
  if (typeof params.cache === 'boolean') out.cache = params.cache;
  if (typeof params.fallback === 'boolean') out.fallback = params.fallback;
  return out;
}

function normalizeAsyncMeta(raw: unknown): AsyncMeta {
  const meta = asRecord<AsyncMeta>(raw);
  return { ...meta, requestId: requireField(meta.requestId, 'request_id', 'AsyncMeta') };
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
    for (const [flag, value] of Object.entries(flags(params))) {
      query[flag] = String(value);
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
    Object.assign(body, flags(params));

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
    Object.assign(body, flags(params));

    const result = await this.http.request('POST', '/v1/validate/async', {
      body,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const payload = asRecord<{ data?: unknown; meta?: unknown }>(snakeToCamel(result.data.json));

    try {
      const context = 'AsyncValidateResponse';
      const data = asRecord<Partial<AsyncValidateData>>(requireField(payload.data, 'data', context));
      return {
        data: {
          data: {
            ...data,
            requestId: requireField(data.requestId, 'request_id', context),
            status: requireField(data.status, 'status', context),
            vatNumber: requireField(data.vatNumber, 'vat_number', context),
          },
          meta: normalizeAsyncMeta(payload.meta),
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
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
    Object.assign(body, flags(params));

    const result = await this.http.request('POST', '/v1/validate/async/batch', {
      body,
      requestId: params.requestId,
    });

    if (result.error) return result;

    const payload = asRecord<{ data?: unknown; meta?: unknown }>(snakeToCamel(result.data.json));

    try {
      const context = 'AsyncBatchValidateResponse';
      const data = asRecord<Partial<AsyncBatchValidateData>>(requireField(payload.data, 'data', context));
      return {
        data: {
          data: {
            ...data,
            batchId: data.batchId ?? null,
            status: requireField(data.status, 'status', context),
            total: requireField(data.total, 'total', context),
            accepted: requireField(data.accepted, 'accepted', context),
            rejected: requireArray<AsyncRejectedItem>(data.rejected, 'rejected', context),
          },
          meta: normalizeAsyncMeta(payload.meta),
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
  }
}
