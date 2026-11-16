import { HttpClient, snakeToCamel, parseRateLimitHeaders } from '../http.js';
import { asRecord, requireArray, requireField, toParseError } from '../parse.js';
import type {
  AvatcadoResult,
  ListRatesResponse,
  GetRateResponse,
  RequestOptions,
  VatRate,
} from '../types.js';

export class Rates {
  constructor(private readonly http: HttpClient) {}

  async list(options?: RequestOptions): Promise<AvatcadoResult<ListRatesResponse>> {
    const result = await this.http.request('GET', '/v1/rates', { requestId: options?.requestId });
    if (result.error) return result;

    const payload = asRecord<{ data?: unknown; meta?: unknown }>(snakeToCamel(result.data.json));

    try {
      const context = 'ListRatesResponse';
      const meta = asRecord<{ requestId?: string; count?: number }>(payload.meta);
      const data = requireArray<VatRate>(payload.data, 'data', context);
      return {
        data: {
          data,
          meta: {
            ...meta,
            requestId: requireField(meta.requestId, 'request_id', context),
            count: meta.count ?? data.length,
          },
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
  }

  async get(countryCode: string, options?: RequestOptions): Promise<AvatcadoResult<GetRateResponse>> {
    const result = await this.http.request('GET', `/v1/rates/${encodeURIComponent(countryCode)}`, {
      requestId: options?.requestId,
    });
    if (result.error) return result;

    const payload = asRecord<{ data?: VatRate | null; meta?: unknown }>(snakeToCamel(result.data.json));

    try {
      const context = 'GetRateResponse';
      const meta = asRecord<{ requestId?: string }>(payload.meta);
      return {
        data: {
          data: requireField(payload.data, 'data', context),
          meta: { ...meta, requestId: requireField(meta.requestId, 'request_id', context) },
          rateLimit: parseRateLimitHeaders(result.data.headers),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: toParseError(err, result.data) };
    }
  }
}
