import {
  AvatcadoError,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  UpstreamError,
} from './errors.js';

import { HttpClient } from './http.js';
import { Vat } from './resources/vat.js';
import { Rates } from './resources/rates.js';
import type { AvatcadoOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://api.avatcado.com';
const DEFAULT_TIMEOUT = 30_000;

class Avatcado {
  static AvatcadoError = AvatcadoError;
  static AuthenticationError = AuthenticationError;
  static ValidationError = ValidationError;
  static RateLimitError = RateLimitError;
  static UpstreamError = UpstreamError;

  readonly vat: Vat;
  readonly rates: Rates;

  constructor(keyOrConfig: string | AvatcadoOptions) {
    let apiKey: string;
    let baseUrl: string;
    let timeout: number;

    if (typeof keyOrConfig === 'string') {
      apiKey = keyOrConfig;
      baseUrl = DEFAULT_BASE_URL;
      timeout = DEFAULT_TIMEOUT;
    } else {
      apiKey = keyOrConfig.apiKey ?? '';
      baseUrl = keyOrConfig.baseUrl ?? DEFAULT_BASE_URL;
      timeout = keyOrConfig.timeout ?? DEFAULT_TIMEOUT;
    }

    if (!apiKey) {
      apiKey = process.env.AVATCADO_API_KEY ?? '';
    }

    if (!apiKey) {
      throw new AvatcadoError(
        'No API key provided. Pass it to the constructor or set AVATCADO_API_KEY environment variable.',
        'missing_api_key',
        0,
        null,
        '',
      );
    }

    const http = new HttpClient(apiKey, baseUrl, timeout);
    this.vat = new Vat(http);
    this.rates = new Rates(http);
  }
}

export default Avatcado;
export { Avatcado, AvatcadoError, AuthenticationError, ValidationError, RateLimitError, UpstreamError };
export { Vat } from './resources/vat.js';
export { Rates } from './resources/rates.js';
export { isBatchSuccess } from './types.js';
export type {
  AvatcadoOptions,
  AvatcadoResult,
  ErrorCode,
  ClientErrorCode,
  ValidateParams,
  Company,
  VatValidationData,
  ResponseMeta,
  BatchResponseMeta,
  RateLimitInfo,
  ValidateResponse,
  ValidateBatchParams,
  BatchItemMeta,
  BatchResultSuccess,
  BatchResultError,
  BatchResult,
  BatchSummary,
  ValidateBatchResponse,
  AsyncValidateParams,
  AsyncValidateData,
  AsyncMeta,
  AsyncValidateResponse,
  AsyncBatchValidateParams,
  AsyncRejectedItem,
  AsyncBatchValidateData,
  AsyncBatchValidateResponse,
  OtherRate,
  VatRate,
  ListRatesResponse,
  GetRateResponse,
} from './types.js';
