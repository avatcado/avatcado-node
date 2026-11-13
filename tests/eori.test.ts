import { describe, it, expect, vi, afterEach } from 'vitest';
import Avatcado, { AvatcadoError, RateLimitError, UpstreamError, ValidationError } from '../src/index.js';

const MOCK_API_KEY = 'avat_live_test123';

function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '500',
      'x-ratelimit-remaining': '499',
      'x-ratelimit-reset': '2026-12-01T00:00:00Z',
      ...headers,
    },
  });
}

// The wire shape GET /v1/eori/validate returns.
const VALID_RESPONSE = {
  data: {
    valid: true,
    eori_number: 'GB123456789000',
    country_code: 'GB',
    company: { name: 'EXAMPLE TRADING LTD', address: '1 HIGH STREET, LONDON, SW1A 1AA' },
    requested_at: '2026-11-13T09:19:29.000Z',
  },
  meta: {
    request_id: 'req_eori_1',
    request_duration_ms: 312,
    source: 'hmrc',
    source_status: 'live',
    cached: false,
    stale: false,
  },
};

function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    error: { code, message, docs_url: `https://docs.avatcado.com/errors/${code}`, ...extra },
    meta: { request_id: 'req_eori_err' },
  };
}

describe('avatcado.eori.validate()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is available on the client', () => {
    expect(new Avatcado(MOCK_API_KEY).eori).toBeDefined();
  });

  it('calls GET /v1/eori/validate with the number and returns camelCased data, meta and rate limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(VALID_RESPONSE));
    const avatcado = new Avatcado(MOCK_API_KEY);

    const { data, error } = await avatcado.eori.validate({ eoriNumber: 'GB123456789000' });

    expect(error).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.avatcado.com/v1/eori/validate?eori_number=GB123456789000');
    expect(init.method).toBe('GET');
    expect(data).toEqual({
      data: {
        valid: true,
        eoriNumber: 'GB123456789000',
        countryCode: 'GB',
        company: { name: 'EXAMPLE TRADING LTD', address: '1 HIGH STREET, LONDON, SW1A 1AA' },
        requestedAt: '2026-11-13T09:19:29.000Z',
      },
      meta: {
        requestId: 'req_eori_1',
        mode: null,
        requestDurationMs: 312,
        source: 'hmrc',
        sourceStatus: 'live',
        cached: false,
        stale: false,
        cachedAt: null,
      },
      rateLimit: expect.objectContaining({ limit: 500, remaining: 499, reset: '2026-12-01T00:00:00Z' }),
    });
  });

  it('trims the number and leaves normalization to the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(VALID_RESPONSE));

    await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: '  gb 123.456.789 000 ' });

    const url = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(url.searchParams.get('eori_number')).toBe('gb 123.456.789 000');
  });

  it('sends cache=false only when the cache is turned off', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockResponse(VALID_RESPONSE));
    const avatcado = new Avatcado(MOCK_API_KEY);

    await avatcado.eori.validate({ eoriNumber: 'GB123456789000', cache: false });
    await avatcado.eori.validate({ eoriNumber: 'GB123456789000', cache: true });
    await avatcado.eori.validate({ eoriNumber: 'GB123456789000' });

    const params = fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams);
    expect(params[0].get('cache')).toBe('false');
    expect(params[1].has('cache')).toBe(false);
    expect(params[2].has('cache')).toBe(false);
  });

  it('forwards a caller-supplied request id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(VALID_RESPONSE));

    await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000', requestId: 'my-trace-1' });

    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('x-request-id')).toBe('my-trace-1');
  });

  it('returns company: null for a valid number whose holder published no details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({ ...VALID_RESPONSE, data: { ...VALID_RESPONSE.data, company: null } }),
    );

    const { data } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(data?.data.valid).toBe(true);
    expect(data?.data.company).toBeNull();
  });

  it('reports a cached answer and a stored answer served during an outage', async () => {
    const cachedAt = '2026-11-01T08:00:00.000Z';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({
          ...VALID_RESPONSE,
          meta: { ...VALID_RESPONSE.meta, source_status: 'cached', cached: true, cached_at: cachedAt },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ...VALID_RESPONSE,
          meta: {
            ...VALID_RESPONSE.meta,
            source: 'ec_eos',
            source_status: 'unavailable',
            cached: true,
            stale: true,
            cached_at: cachedAt,
          },
        }),
      );
    const avatcado = new Avatcado(MOCK_API_KEY);

    const cached = await avatcado.eori.validate({ eoriNumber: 'GB123456789000' });
    const stored = await avatcado.eori.validate({ eoriNumber: 'IT01234567890' });

    expect(cached.data?.meta).toMatchObject({ sourceStatus: 'cached', cached: true, stale: false, cachedAt });
    expect(stored.data?.meta).toMatchObject({
      source: 'ec_eos',
      sourceStatus: 'unavailable',
      cached: true,
      stale: true,
      cachedAt,
    });
  });

  it('reports test mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({ ...VALID_RESPONSE, meta: { ...VALID_RESPONSE.meta, mode: 'test', source: 'test' } }),
    );

    const { data } = await new Avatcado('avat_test_key').eori.validate({ eoriNumber: 'NL111111111' });

    expect(data?.meta.mode).toBe('test');
    expect(data?.meta.source).toBe('test');
  });

  it('rejects an empty number without calling the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const avatcado = new Avatcado(MOCK_API_KEY);

    for (const eoriNumber of ['', '   ']) {
      const { data, error } = await avatcado.eori.validate({ eoriNumber });
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(ValidationError);
      expect(error?.code).toBe('missing_parameter');
      expect(error?.message).toBe('eori_number is required');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a ValidationError with the echoed number for invalid_eori_format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        errorBody(
          'invalid_eori_format',
          'Invalid EORI number format: GB123. GB EORI numbers are GB followed by 12 to 15 digits',
          { eori_number: 'GB123' },
        ),
        422,
      ),
    );

    const { data, error } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'gb123' });

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.code).toBe('invalid_eori_format');
    expect(error?.statusCode).toBe(422);
    expect(error?.eoriNumber).toBe('GB123');
    expect(error?.vatNumber).toBeNull();
    expect(error?.docsUrl).toBe('https://docs.avatcado.com/errors/invalid_eori_format');
    expect(error?.requestId).toBe('req_eori_err');
  });

  it('returns an UpstreamError with retryAfter and the echoed number when the register is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        errorBody('upstream_unavailable', 'The HMRC EORI service is unavailable', { eori_number: 'GB123456789000' }),
        503,
        { 'retry-after': '60' },
      ),
    );

    const { error } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).retryAfter).toBe(60);
    expect((error as UpstreamError).validationId).toBeNull();
    expect(error?.eoriNumber).toBe('GB123456789000');
  });

  it('returns a RateLimitError with the echoed number when the quota is used up', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        errorBody('rate_limit_exceeded', 'Monthly limit of 500 requests exceeded', { eori_number: 'GB123456789000' }),
        429,
        { 'retry-after': '3600' },
      ),
    );

    const { error } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3600);
    expect(error?.eoriNumber).toBe('GB123456789000');
  });

  it('returns a parse_error instead of throwing when a 200 body has no data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ meta: { request_id: 'req_x' } }));

    const { data, error } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(AvatcadoError);
    expect(error?.code).toBe('parse_error');
  });

  it('returns a parse_error when a 200 body has no request id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ data: VALID_RESPONSE.data, meta: {} }));

    const { error } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(error?.code).toBe('parse_error');
  });

  it('normalizes omitted optional meta fields to null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({ data: VALID_RESPONSE.data, meta: { request_id: 'req_min' } }),
    );

    const { data } = await new Avatcado(MOCK_API_KEY).eori.validate({ eoriNumber: 'GB123456789000' });

    expect(data?.meta).toEqual({
      requestId: 'req_min',
      mode: null,
      requestDurationMs: null,
      source: null,
      sourceStatus: null,
      cached: null,
      stale: null,
      cachedAt: null,
    });
  });
});

describe('error context on the VAT endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves eoriNumber null on a VAT error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(errorBody('invalid_vat_format', 'Invalid VAT number format', { vat_number: 'DE123' }), 422),
    );

    const { error } = await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123' });

    expect(error?.vatNumber).toBe('DE123');
    expect(error?.eoriNumber).toBeNull();
  });
});
