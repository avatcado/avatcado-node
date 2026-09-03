import { ValidationError } from '../errors.js';
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
  ValidationSource,
  ValidationResultMeta,
  AsyncValidateParams,
  AsyncValidateResponse,
  AsyncValidateData,
  AsyncMeta,
  AsyncBatchValidateParams,
  AsyncBatchValidateResponse,
  AsyncBatchValidateData,
} from '../types.js';

// Wire shapes after snakeToCamel. Optional fields are absent on the wire when
// not applicable (e.g. cached_at when cached is false); the SDK normalizes them to null.
interface WireResultMeta {
  source: ValidationSource;
  sourceStatus: SourceStatus;
  cached?: boolean | null;
  stale?: boolean | null;
  cachedAt?: string | null;
}

interface WireResponseMeta extends WireResultMeta {
  requestId: string;
  mode?: 'test' | null;
  requestDurationMs?: number | null;
}

interface WireBatchResponseMeta {
  requestId: string;
  mode?: 'test' | null;
  requestDurationMs?: number | null;
}

type WireBatchResult =
  | { data: VatValidationData; meta: WireResultMeta }
  | { error: { code: string; message: string; vatNumber?: string }; meta?: { vatNumber: string } };

function normalizeResultMeta(meta: WireResultMeta): ValidationResultMeta {
  return {
    source: meta.source,
    sourceStatus: meta.sourceStatus,
    cached: meta.cached ?? false,
    stale: meta.stale ?? false,
    cachedAt: meta.cachedAt ?? null,
  };
}

function normalizeResponseMeta(meta: WireResponseMeta): ResponseMeta {
  return {
    ...normalizeResultMeta(meta),
    requestId: meta.requestId,
    mode: meta.mode ?? null,
    requestDurationMs: meta.requestDurationMs ?? null,
  };
}

function normalizeBatchResponseMeta(meta: WireBatchResponseMeta): BatchResponseMeta {
  return {
    requestId: meta.requestId,
    mode: meta.mode ?? null,
    requestDurationMs: meta.requestDurationMs ?? null,
  };
}

function normalizeBatchResult(item: WireBatchResult): BatchResult {
  if ('data' in item) {
    return { data: item.data, meta: normalizeResultMeta(item.meta) };
  }
  // Older API versions only echo the VAT number in meta; newer ones put it on error.
  const vatNumber = item.error.vatNumber ?? item.meta?.vatNumber ?? '';
  return {
    error: { ...item.error, vatNumber },
    meta: { vatNumber: item.meta?.vatNumber ?? vatNumber },
  };
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

    const transformed = snakeToCamel(result.data.json) as {
      data: VatValidationData;
      meta: WireResponseMeta;
    };

    return {
      data: {
        data: transformed.data,
        meta: normalizeResponseMeta(transformed.meta),
        rateLimit: parseRateLimitHeaders(result.data.headers),
      },
      error: null,
    };
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

    const transformed = snakeToCamel(result.data.json) as {
      data: { results: WireBatchResult[]; summary: BatchSummary };
      meta: WireBatchResponseMeta;
    };

    return {
      data: {
        data: {
          results: transformed.data.results.map(normalizeBatchResult),
          summary: transformed.data.summary,
        },
        meta: normalizeBatchResponseMeta(transformed.meta),
        rateLimit: parseRateLimitHeaders(result.data.headers),
      },
      error: null,
    };
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
