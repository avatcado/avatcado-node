import { AvatcadoError, ValidationError } from '../errors.js';
import { HttpClient, snakeToCamel, parseRateLimitHeaders } from '../http.js';
import type {
  AvatcadoResult,
  EoriResponseMeta,
  EoriSourceStatus,
  EoriValidateParams,
  EoriValidateResponse,
  EoriValidationData,
} from '../types.js';

// Wire shape after snakeToCamel. The API omits optional meta fields rather than sending null;
// the SDK normalizes every absent field to null.
interface WireEoriMeta {
  requestId?: string | null;
  mode?: 'test' | null;
  requestDurationMs?: number | null;
  source?: string | null;
  sourceStatus?: EoriSourceStatus | null;
  cached?: boolean | null;
  stale?: boolean | null;
  cachedAt?: string | null;
}

function asRecord<T extends object>(value: unknown): T {
  return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as T;
}

function parseError(field: string, context: string, response: { headers: Headers; status: number }): AvatcadoError {
  return new AvatcadoError(
    `Missing required field "${field}" in ${context}`,
    'parse_error',
    response.status,
    response.headers.get('x-request-id'),
    '',
  );
}

export class Eori {
  constructor(private readonly http: HttpClient) {}

  /**
   * Checks one EORI number against the register that issued it: HMRC for GB numbers, the
   * European Commission's EORI validation service for the 27 EU member states and XI.
   */
  async validate(params: EoriValidateParams): Promise<AvatcadoResult<EoriValidateResponse>> {
    if (!params.eoriNumber || !params.eoriNumber.trim()) {
      return {
        data: null,
        error: new ValidationError('eori_number is required', 'missing_parameter', 400, null, ''),
      };
    }

    const query: Record<string, string> = { eori_number: params.eoriNumber.trim() };
    if (params.cache === false) {
      query.cache = 'false';
    }

    const result = await this.http.request('GET', '/v1/eori/validate', {
      query,
      requestId: params.requestId,
    });
    if (result.error) return result;

    const payload = asRecord<{ data?: EoriValidationData | null; meta?: unknown }>(snakeToCamel(result.data.json));
    const wireMeta = asRecord<WireEoriMeta>(payload.meta);

    // A malformed 2xx body is reported as a parse_error result, never thrown.
    if (payload.data === null || payload.data === undefined) {
      return { data: null, error: parseError('data', 'EoriValidateResponse', result.data) };
    }
    if (wireMeta.requestId === null || wireMeta.requestId === undefined) {
      return { data: null, error: parseError('request_id', 'EoriResponseMeta', result.data) };
    }

    const meta: EoriResponseMeta = {
      requestId: wireMeta.requestId,
      mode: wireMeta.mode ?? null,
      requestDurationMs: wireMeta.requestDurationMs ?? null,
      source: wireMeta.source ?? null,
      sourceStatus: wireMeta.sourceStatus ?? null,
      cached: wireMeta.cached ?? null,
      stale: wireMeta.stale ?? null,
      cachedAt: wireMeta.cachedAt ?? null,
    };

    return {
      data: { data: payload.data, meta, rateLimit: parseRateLimitHeaders(result.data.headers) },
      error: null,
    };
  }
}
