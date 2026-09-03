// --- Core result tuple ---

import type { AvatcadoError } from './errors.js';

export type AvatcadoResult<T> = { data: T; error: null } | { data: null; error: AvatcadoError };

// --- Error codes ---

export type ErrorCode =
  | 'missing_parameter'
  | 'invalid_vat_format'
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
  timeout?: number;
}

// --- Validate ---

export interface ValidateParams {
  vatNumber: string;
  requesterVatNumber?: string;
  cache?: boolean;
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
   * a national registry (`dgfip`, `prh`, `kas`, `anaf`, `ares`, `vid`, `vmi`) when
   * `sourceStatus` is `'fallback'`, or `test` in test mode. A plain string, not an enum.
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

export interface ValidateBatchParams {
  vatNumbers: string[];
  requesterVatNumber?: string;
  cache?: boolean;
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

export interface AsyncValidateParams {
  vatNumber: string;
  requesterVatNumber?: string;
  cache?: boolean;
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

export interface AsyncBatchValidateParams {
  vatNumbers: string[];
  requesterVatNumber?: string;
  cache?: boolean;
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
