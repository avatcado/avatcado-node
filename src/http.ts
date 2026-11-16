declare const __VERSION__: string;

import {
  AvatcadoError,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  UpstreamError,
} from './errors.js';

import type { AvatcadoResult, RateLimitInfo } from './types.js';

const AUTHENTICATION_CODES = new Set(['unauthorized', 'tier_insufficient', 'forbidden', 'key_revoked']);
const VALIDATION_CODES = new Set([
  'invalid_vat_format',
  'invalid_eori_format',
  'missing_parameter',
  'validation_error',
  'invalid_json',
]);
const RATE_LIMIT_CODES = new Set(['rate_limit_exceeded', 'burst_limit_exceeded']);
const UPSTREAM_CODES = new Set(['upstream_unavailable', 'upstream_member_state_unavailable']);

export function snakeToCamel(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(snakeToCamel);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = snakeToCamel(val);
    }
    return result;
  }
  return value;
}

function parseRateLimitHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

/**
 * Reads Retry-After as seconds. The API sends whole seconds; a proxy may send an HTTP date,
 * which is converted to seconds from now. Anything else is `null`, never `NaN`.
 */
export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds : null;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: parseRateLimitHeader(headers, 'x-ratelimit-limit'),
    remaining: parseRateLimitHeader(headers, 'x-ratelimit-remaining'),
    reset: headers.get('x-ratelimit-reset'),
    retryAfter: parseRetryAfter(headers),
    burstLimit: parseRateLimitHeader(headers, 'x-burst-limit'),
    burstRemaining: parseRateLimitHeader(headers, 'x-burst-remaining'),
  };
}

function buildError(
  message: string,
  code: string,
  statusCode: number,
  requestId: string | null,
  docsUrl: string,
  retryAfter: number | null,
  details: Array<{ field: string; message: string }> | null,
  vatNumber: string | null,
  requesterVatNumber: string | null,
  validationId: string | null,
): AvatcadoError {
  if (AUTHENTICATION_CODES.has(code)) {
    return new AuthenticationError(message, code, statusCode, requestId, docsUrl, vatNumber, requesterVatNumber);
  }
  if (VALIDATION_CODES.has(code)) {
    return new ValidationError(message, code, statusCode, requestId, docsUrl, details, vatNumber, requesterVatNumber);
  }
  if (RATE_LIMIT_CODES.has(code)) {
    return new RateLimitError(message, code, statusCode, requestId, docsUrl, retryAfter, vatNumber, requesterVatNumber);
  }
  if (UPSTREAM_CODES.has(code)) {
    return new UpstreamError(
      message, code, statusCode, requestId, docsUrl, retryAfter, vatNumber, requesterVatNumber, validationId,
    );
  }
  return new AvatcadoError(message, code, statusCode, requestId, docsUrl, details, vatNumber, requesterVatNumber);
}

export interface HttpRequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  requestId?: string;
}

export interface HttpClientOptions {
  /** Extra attempts after a retryable failure. 0 turns retries off. */
  maxRetries?: number;
  /** Longest wait before one retry, in milliseconds. A longer Retry-After is not retried. */
  maxRetryDelay?: number;
}

type HttpResult = AvatcadoResult<{ json: unknown; headers: Headers; status: number }>;

const DEFAULT_MAX_RETRY_DELAY = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

function setRetryAfter(error: AvatcadoError, retryAfter: number | null): AvatcadoError {
  // Set after construction so the error classes keep their positional constructor signatures.
  (error as { retryAfter: number | null }).retryAfter = retryAfter;
  return error;
}

/**
 * How long to wait before retrying `error`, in milliseconds, or `null` when it must not be retried.
 *
 * A burst-limit 429 and a 503 are answers from the API saying the request was not processed, so
 * they are retried on every method. A timeout, a network error, a 502 and a 504 leave open whether
 * the request was processed, so they are retried only when the request is safe to repeat (GET).
 */
export function retryDelayMs(
  error: AvatcadoError,
  idempotent: boolean,
  attempt: number,
  maxRetryDelay: number,
): number | null {
  const notProcessed =
    (error.statusCode === 429 && error.code === 'burst_limit_exceeded') || error.statusCode === 503;
  const outcomeUnknown =
    error.code === 'timeout' || error.code === 'network_error' || error.statusCode === 502 || error.statusCode === 504;
  if (!notProcessed && !(idempotent && outcomeUnknown)) return null;

  if (error.retryAfter !== null) {
    const wait = error.retryAfter * 1000;
    return wait <= maxRetryDelay ? wait : null;
  }
  const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const jittered = backoff / 2 + Math.random() * (backoff / 2);
  return Math.min(jittered, maxRetryDelay);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly maxRetryDelay: number;

  constructor(apiKey: string, baseUrl: string, timeout: number, options: HttpClientOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    const maxRetries = Number(options.maxRetries ?? 0);
    this.maxRetries = Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0;
    const maxRetryDelay = Number(options.maxRetryDelay ?? DEFAULT_MAX_RETRY_DELAY);
    this.maxRetryDelay = Number.isFinite(maxRetryDelay) && maxRetryDelay >= 0 ? maxRetryDelay : DEFAULT_MAX_RETRY_DELAY;
  }

  async request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResult> {
    const idempotent = method === 'GET';
    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt(method, path, options);
      if (!result.error || attempt >= this.maxRetries) return result;
      const wait = retryDelayMs(result.error, idempotent, attempt, this.maxRetryDelay);
      if (wait === null) return result;
      await sleep(wait);
    }
  }

  private async attempt(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResult> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `avatcado-node/${__VERSION__}`,
    };
    if (options?.requestId) {
      headers['X-Request-Id'] = options.requestId;
    }

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    // The timer stays armed until the body is read: a server that sends headers and then
    // stalls must not hang the caller.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    init.signal = controller.signal;

    try {
      let response: Response;
      try {
        response = await fetch(url.toString(), init);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return { data: null, error: this.timeoutError() };
        }
        return {
          data: null,
          error: new AvatcadoError(
            error instanceof Error ? error.message : 'Network request failed',
            'network_error',
            0,
            null,
            '',
          ),
        };
      }

      if (!response.ok) {
        return await this.handleErrorResponse(response, controller.signal);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) return { data: null, error: this.timeoutError() };
        return {
          data: null,
          error: new AvatcadoError(
            `Expected JSON response but received unparseable body (HTTP ${response.status})`,
            'parse_error',
            response.status,
            response.headers.get('x-request-id'),
            '',
          ),
        };
      }

      return { data: { json, headers: response.headers, status: response.status }, error: null };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private timeoutError(): AvatcadoError {
    return new AvatcadoError(`Request timed out after ${this.timeout}ms`, 'timeout', 0, null, '');
  }

  private async handleErrorResponse(response: Response, signal: AbortSignal): Promise<AvatcadoResult<never>> {
    const retryAfter = parseRetryAfter(response.headers);

    let body: Record<string, unknown> | undefined;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      if (signal.aborted) return { data: null, error: this.timeoutError() };
      // No JSON body: a gateway answered instead of the API. The headers still identify the request.
      return {
        data: null,
        error: setRetryAfter(
          new AvatcadoError(
            `HTTP ${response.status}: ${response.statusText}`,
            'unknown_error',
            response.status,
            response.headers.get('x-request-id'),
            '',
          ),
          retryAfter,
        ),
      };
    }

    const errorObj =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body.error ?? body)
        : {};
    const error = (typeof errorObj === 'object' && errorObj !== null ? errorObj : {}) as Record<string, unknown>;
    const rawMeta = typeof body === 'object' && body !== null ? body.meta : undefined;
    const meta = (typeof rawMeta === 'object' && rawMeta !== null ? rawMeta : {}) as Record<string, unknown>;
    const message = typeof error.message === 'string' ? error.message : `HTTP ${response.status}`;
    const code = typeof error.code === 'string' ? error.code : 'unknown_error';
    const requestId =
      typeof meta.request_id === 'string' ? meta.request_id : response.headers.get('x-request-id');
    const docsUrl = typeof error.docs_url === 'string' ? error.docs_url : '';

    const details = Array.isArray(error.details) ? (error.details as Array<{ field: string; message: string }>) : null;
    const vatNumber = typeof error.vat_number === 'string' ? error.vat_number : null;
    const requesterVatNumber = typeof error.requester_vat_number === 'string' ? error.requester_vat_number : null;
    const validationId = typeof meta.validation_id === 'string' ? meta.validation_id : null;

    const builtError = setRetryAfter(
      buildError(
        message, code, response.status, requestId, docsUrl, retryAfter, details, vatNumber, requesterVatNumber, validationId,
      ),
      retryAfter,
    );
    // Set after construction so the error classes keep their positional constructor signatures.
    if (typeof error.eori_number === 'string') {
      (builtError as { eoriNumber: string | null }).eoriNumber = error.eori_number;
    }

    return { data: null, error: builtError };
  }
}
