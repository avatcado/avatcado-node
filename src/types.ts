// --- Core result tuple ---

import type { AvatcadoError } from './errors.js';

export type AvatcadoResult<T> = { data: T; error: null } | { data: null; error: AvatcadoError };

// --- Error codes ---

export type ErrorCode =
  | 'missing_parameter'
  | 'invalid_vat_format'
  | 'invalid_eori_format'
  | 'unauthorized'
  | 'rate_limit_exceeded'
  | 'burst_limit_exceeded'
  | 'upstream_unavailable'
  | 'upstream_member_state_unavailable'
  | 'validation_error'
  | 'invalid_json'
  | 'tier_insufficient'
  | 'forbidden'
  | 'key_revoked'
  | 'key_limit_reached'
  | 'internal_error'
  | 'not_found'
  | 'webhook_not_configured';

/** Error codes generated client-side by the SDK (not returned by the API). */
export type ClientErrorCode =
  | 'timeout'
  | 'network_error'
  | 'parse_error'
  | 'unknown_error'
  | 'missing_api_key'
  | 'batch_too_large';

// --- Configuration ---

export interface AvatcadoOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds, covering the request and the response body. Default 30000. */
  timeout?: number;
  /**
   * Extra attempts after a retryable failure. Default 0: the SDK does not retry.
   *
   * When set, a burst-limit 429 and a 503 are retried on every method. A timeout, a network
   * error, a 502 and a 504 are retried on GET requests only (`vat.validate`, `rates.*`,
   * `eori.validate`), because a POST may already have been accepted. The SDK waits for
   * `Retry-After` when the API sends it, otherwise 0.5 s doubling up to 8 s.
   */
  maxRetries?: number;
  /**
   * Longest wait before one retry, in milliseconds. Default 60000. An error whose
   * `Retry-After` is longer (the monthly quota, a register outage) is returned at once.
   */
  maxRetryDelay?: number;
}

/** Options accepted by calls that take no other parameters. */
export interface RequestOptions {
  /** Sent as `X-Request-Id` and echoed back in `meta.requestId`. */
  requestId?: string;
}

/**
 * Flags shared by the four VAT validation calls. Leave a flag unset to get the API default,
 * which depends on the request: both default to `true`, and both default to `false` when
 * `requesterVatNumber` is supplied.
 */
export interface ValidationFlags {
  /**
   * `false` skips the cache and forces a fresh lookup. `true` next to `requesterVatNumber`
   * opts back in to cached and stored results.
   */
  cache?: boolean;
  /**
   * `false` stops a VIES outage from being answered by a national register. `true` next to
   * `requesterVatNumber` accepts a register answer, which never carries a consultation number.
   * Applies on Pro and Business plans; ignored on Free.
   */
  fallback?: boolean;
}

// --- Validate ---

export interface ValidateParams extends ValidationFlags {
  vatNumber: string;
  requesterVatNumber?: string;
  requestId?: string;
}

export interface Company {
  name: string;
  address: string | null;
}

export interface VatValidationData {
  valid: boolean;
  vatNumber: string;
  countryCode: string;
  company: Company | null;
  consultationNumber?: string | null;
  requestedAt: string;
}

/**
 * How the served result was obtained.
 * - `live`: fresh upstream lookup.
 * - `cached`: served from the 25-day cache.
 * - `unavailable`: upstream down, most recent cached row served (check `stale`).
 * - `degraded`: upstream answered but the result looked like a silent false negative; prior row served.
 * - `fallback`: VIES was down and the national registry named in `source` answered.
 */
export type SourceStatus = 'live' | 'cached' | 'unavailable' | 'degraded' | 'fallback';

/**
 * Meta shared by every validation result: single validate and successful batch items.
 *
 * The current API always sends `source`, `sourceStatus`, `cached` and `stale`, and
 * `cachedAt` exactly when `cached` is true. Every field is `null` when the server omits
 * it, e.g. on responses from older API versions.
 */
export interface ValidationResultMeta {
  /**
   * Registry that produced the served data: `vies`, `hmrc`, `bfs`, `brreg`, `abr`,
   * a national registry (`anaf`, `ares`, `dgfip`, `fssr`, `furs`, `kbo`, `porezna`, `prh`,
   * `rik`, `vid`) when `sourceStatus` is `'fallback'`, or `test` in test mode. A plain
   * string, not an enum: new registries appear without an SDK release.
   */
  source: string | null;
  sourceStatus: SourceStatus | null;
  cached: boolean | null;
  /** True when the served cache row is older than the 25-day TTL. Only possible on upstream failure. */
  stale: boolean | null;
  /** ISO 8601 timestamp of when the served row was fetched. Present exactly when `cached` is true. */
  cachedAt: string | null;
}

export interface ResponseMeta extends ValidationResultMeta {
  requestId: string;
  mode: 'test' | null;
  requestDurationMs: number | null;
}

// --- EORI ---

export interface EoriValidateParams {
  /** The EORI number to check. Spaces, dots, dashes and casing are normalized by the API. */
  eoriNumber: string;
  /** Pass `false` to skip the cache and ask the register again. Unset means the API default (`true`). */
  cache?: boolean;
  requestId?: string;
}

export interface EoriValidationData {
  valid: boolean;
  /** The normalized number that was checked. A Greek number sent with `EL` comes back with `GR`. */
  eoriNumber: string;
  /** The two-letter prefix (`XI` for Northern Ireland). */
  countryCode: string;
  /**
   * Trader name and address from the register. `null` when the number is not valid, and `null`
   * for a valid number whose holder did not consent to publication, which is common.
   */
  company: Company | null;
  requestedAt: string;
}

/**
 * How an EORI answer was obtained.
 * - `live`: fresh check with the register.
 * - `cached`: served from the cache.
 * - `unavailable`: the register was down and the most recent stored answer was served (check `stale`).
 */
export type EoriSourceStatus = 'live' | 'cached' | 'unavailable';

/** Every optional field is `null` when the server omits it. */
export interface EoriResponseMeta {
  requestId: string;
  mode: 'test' | null;
  requestDurationMs: number | null;
  /**
   * Register that produced the answer: `ec_eos` (the European Commission's EORI validation
   * service, for EU and XI numbers), `hmrc` (GB numbers), or `test` in test mode. A plain string.
   */
  source: string | null;
  sourceStatus: EoriSourceStatus | null;
  cached: boolean | null;
  /** True when the served stored answer is older than the cache window. Only possible when the register is down. */
  stale: boolean | null;
  /** ISO 8601 timestamp of when the served answer was first stored. Present exactly when `cached` is true. */
  cachedAt: string | null;
}

export interface EoriValidateResponse {
  data: EoriValidationData;
  meta: EoriResponseMeta;
  rateLimit: RateLimitInfo;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
  retryAfter: number | null;
  burstLimit: number | null;
  burstRemaining: number | null;
}

export interface ValidateResponse {
  data: VatValidationData;
  meta: ResponseMeta;
  rateLimit: RateLimitInfo;
}

// --- Batch Validate ---

export interface ValidateBatchParams extends ValidationFlags {
  vatNumbers: string[];
  requesterVatNumber?: string;
  requestId?: string;
}

export type BatchItemMeta = ValidationResultMeta;

export interface BatchResultSuccess {
  data: VatValidationData;
  meta: BatchItemMeta;
}

export interface BatchResultError {
  error: { code: string; message: string; vatNumber: string };
  meta: {
    /** @deprecated Use `error.vatNumber` instead. Still populated by the API; the SDK also fills `error.vatNumber` from it for older responses. */
    vatNumber: string;
  };
}

export type BatchResult = BatchResultSuccess | BatchResultError;

export function isBatchSuccess(item: BatchResult): item is BatchResultSuccess {
  return 'data' in item;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
}

export interface BatchResponseMeta {
  requestId: string;
  mode: 'test' | null;
  requestDurationMs: number | null;
}

export interface ValidateBatchResponse {
  data: { results: BatchResult[]; summary: BatchSummary };
  meta: BatchResponseMeta;
  rateLimit: RateLimitInfo;
}

// --- Async Validate ---

export interface AsyncValidateParams extends ValidationFlags {
  vatNumber: string;
  requesterVatNumber?: string;
  requestId?: string;
}

export interface AsyncValidateData {
  requestId: string;
  status: 'pending';
  vatNumber: string;
}

export interface AsyncMeta {
  requestId: string;
}

export interface AsyncValidateResponse {
  data: AsyncValidateData;
  meta: AsyncMeta;
  rateLimit: RateLimitInfo;
}

// --- Async Batch Validate ---

export interface AsyncBatchValidateParams extends ValidationFlags {
  vatNumbers: string[];
  requesterVatNumber?: string;
  requestId?: string;
}

export interface AsyncRejectedItem {
  vatNumber: string;
  error: { code: string; message: string };
}

export interface AsyncBatchValidateData {
  batchId: string | null;
  status: 'pending' | 'completed';
  total: number;
  accepted: number;
  rejected: AsyncRejectedItem[];
}

export interface AsyncBatchValidateResponse {
  data: AsyncBatchValidateData;
  meta: AsyncMeta;
  rateLimit: RateLimitInfo;
}

// --- Rates ---

export interface OtherRate {
  rate: number;
  type: string;
}

export interface VatRate {
  countryCode: string;
  countryName: string;
  currency: string;
  standardRate: number;
  otherRates: OtherRate[];
  updatedAt: string;
}

export interface ListRatesResponse {
  data: VatRate[];
  meta: { requestId: string; count: number };
  rateLimit: RateLimitInfo;
}

export interface GetRateResponse {
  data: VatRate;
  meta: { requestId: string };
  rateLimit: RateLimitInfo;
}
