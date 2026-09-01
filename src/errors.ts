export class AvatcadoError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | null;
  readonly docsUrl: string;
  readonly details: Array<{ field: string; message: string }> | null;
  readonly vatNumber: string | null;
  readonly requesterVatNumber: string | null;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId: string | null,
    docsUrl: string,
    details: Array<{ field: string; message: string }> | null = null,
    vatNumber: string | null = null,
    requesterVatNumber: string | null = null,
  ) {
    super(message);
    this.name = 'AvatcadoError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.docsUrl = docsUrl;
    this.details = details;
    this.vatNumber = vatNumber;
    this.requesterVatNumber = requesterVatNumber;
  }
}

export class AuthenticationError extends AvatcadoError {
  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId: string | null,
    docsUrl: string,
    vatNumber: string | null = null,
    requesterVatNumber: string | null = null,
  ) {
    super(message, code, statusCode, requestId, docsUrl, null, vatNumber, requesterVatNumber);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends AvatcadoError {
  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId: string | null,
    docsUrl: string,
    details: Array<{ field: string; message: string }> | null = null,
    vatNumber: string | null = null,
    requesterVatNumber: string | null = null,
  ) {
    super(message, code, statusCode, requestId, docsUrl, details, vatNumber, requesterVatNumber);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends AvatcadoError {
  readonly retryAfter: number | null;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId: string | null,
    docsUrl: string,
    retryAfter: number | null,
    vatNumber: string | null = null,
    requesterVatNumber: string | null = null,
  ) {
    super(message, code, statusCode, requestId, docsUrl, null, vatNumber, requesterVatNumber);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class UpstreamError extends AvatcadoError {
  readonly retryAfter: number | null;
  readonly validationId: string | null;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId: string | null,
    docsUrl: string,
    retryAfter: number | null,
    vatNumber: string | null = null,
    requesterVatNumber: string | null = null,
    validationId: string | null = null,
  ) {
    super(message, code, statusCode, requestId, docsUrl, null, vatNumber, requesterVatNumber);
    this.name = 'UpstreamError';
    this.retryAfter = retryAfter;
    this.validationId = validationId;
  }
}
