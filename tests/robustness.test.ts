import { describe, it, expect, vi, afterEach } from 'vitest';
import Avatcado, { AvatcadoError, RateLimitError, UpstreamError } from '../src/index.js';

const MOCK_API_KEY = 'avat_live_test123';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_header', ...headers },
  });
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// Every method promises a `{ data, error }` result and never throws. A 2xx body that is not
// the documented shape has to come back as a parse_error, on every method.
describe('malformed 2xx bodies become a parse_error result', () => {
  const calls: Array<[string, (client: Avatcado) => Promise<{ data: unknown; error: AvatcadoError | null }>]> = [
    ['vat.validateAsync', (c) => c.vat.validateAsync({ vatNumber: 'DE123456789' })],
    ['vat.validateBatchAsync', (c) => c.vat.validateBatchAsync({ vatNumbers: ['DE123456789'] })],
    ['rates.list', (c) => c.rates.list()],
    ['rates.get', (c) => c.rates.get('NL')],
  ];

  for (const [name, call] of calls) {
    it(`${name}: a null body is a parse_error, not a thrown TypeError`, async () => {
      mockFetch(jsonResponse(null));
      const result = await call(new Avatcado(MOCK_API_KEY));
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(AvatcadoError);
      expect(result.error!.code).toBe('parse_error');
      expect(result.error!.statusCode).toBe(200);
      expect(result.error!.requestId).toBe('req_header');
    });

    it(`${name}: a body without data is a parse_error`, async () => {
      mockFetch(jsonResponse({ meta: { request_id: 'req_1' } }));
      const result = await call(new Avatcado(MOCK_API_KEY));
      expect(result.data).toBeNull();
      expect(result.error!.code).toBe('parse_error');
      expect(result.error!.message).toContain('data');
    });

    it(`${name}: a body without meta.request_id is a parse_error`, async () => {
      mockFetch(jsonResponse({ data: name === 'rates.list' ? [] : {}, meta: {} }));
      const result = await call(new Avatcado(MOCK_API_KEY));
      expect(result.data).toBeNull();
      expect(result.error!.code).toBe('parse_error');
    });
  }

  it('vat.validateAsync: names the missing field', async () => {
    mockFetch(jsonResponse({ data: { request_id: 'r1', status: 'pending' }, meta: { request_id: 'req_1' } }));
    const result = await new Avatcado(MOCK_API_KEY).vat.validateAsync({ vatNumber: 'DE123456789' });
    expect(result.error!.code).toBe('parse_error');
    expect(result.error!.message).toContain('vat_number');
  });

  it('vat.validateBatchAsync: rejected must be a list, batch_id may be null', async () => {
    mockFetch(
      jsonResponse({
        data: { batch_id: null, status: 'completed', total: 1, accepted: 0, rejected: [] },
        meta: { request_id: 'req_1' },
      }),
    );
    const ok = await new Avatcado(MOCK_API_KEY).vat.validateBatchAsync({ vatNumbers: ['XX'] });
    expect(ok.error).toBeNull();
    expect(ok.data!.data.batchId).toBeNull();

    vi.restoreAllMocks();
    mockFetch(
      jsonResponse({ data: { batch_id: 'b1', status: 'pending', total: 1, accepted: 1 }, meta: { request_id: 'r' } }),
    );
    const bad = await new Avatcado(MOCK_API_KEY).vat.validateBatchAsync({ vatNumbers: ['DE123456789'] });
    expect(bad.error!.code).toBe('parse_error');
    expect(bad.error!.message).toContain('rejected');
  });

  it('rates.list: data that is not a list is a parse_error', async () => {
    mockFetch(jsonResponse({ data: { country_code: 'NL' }, meta: { request_id: 'req_1', count: 1 } }));
    const result = await new Avatcado(MOCK_API_KEY).rates.list();
    expect(result.error!.code).toBe('parse_error');
  });
});

// A gateway in front of the API answers a timed-out function with an HTML page. The request
// id and Retry-After headers are still there and must survive.
describe('error responses without a JSON body', () => {
  it('keeps the request id and Retry-After from the headers', async () => {
    mockFetch(
      new Response('<html>Gateway Timeout</html>', {
        status: 504,
        statusText: 'Gateway Timeout',
        headers: { 'x-request-id': 'req_gateway', 'retry-after': '7' },
      }),
    );
    const { error } = await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789' });
    expect(error!.code).toBe('unknown_error');
    expect(error!.statusCode).toBe(504);
    expect(error!.requestId).toBe('req_gateway');
    expect(error!.retryAfter).toBe(7);
  });
});

describe('retryAfter on errors', () => {
  const errorBody = (code: string) => ({
    error: { code, message: 'nope', docs_url: `https://docs.avatcado.com/errors/${code}` },
    meta: { request_id: 'req_err' },
  });

  it('is set on a base AvatcadoError when the API sends Retry-After (503 internal_error)', async () => {
    mockFetch(jsonResponse(errorBody('internal_error'), 503, { 'retry-after': '5' }));
    const { error } = await new Avatcado(MOCK_API_KEY).rates.list();
    expect(error).toBeInstanceOf(AvatcadoError);
    expect(error!.code).toBe('internal_error');
    expect(error!.retryAfter).toBe(5);
  });

  it('is null when the API sends no Retry-After', async () => {
    mockFetch(jsonResponse(errorBody('not_found'), 404));
    const { error } = await new Avatcado(MOCK_API_KEY).rates.get('XX');
    expect(error!.retryAfter).toBeNull();
  });

  it('is null on client-side errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const { error } = await new Avatcado(MOCK_API_KEY).rates.list();
    expect(error!.code).toBe('network_error');
    expect(error!.retryAfter).toBeNull();
  });

  it('is never NaN: an unparseable Retry-After is null', async () => {
    mockFetch(jsonResponse(errorBody('burst_limit_exceeded'), 429, { 'retry-after': 'soon' }));
    const { error } = await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789' });
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error!.retryAfter).toBeNull();
  });

  it('converts an HTTP date into seconds from now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    try {
      mockFetch(
        jsonResponse(errorBody('upstream_unavailable'), 503, { 'retry-after': 'Mon, 16 Nov 2026 12:00:30 GMT' }),
      );
      const { error } = await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789' });
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error!.retryAfter).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The timeout has to cover the whole exchange. A server that sends headers and then stalls
// the body must not hang the caller.
describe('timeout covers the response body', () => {
  function stalledBody(status: number) {
    return (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('This operation was aborted');
            err.name = 'AbortError';
            controller.error(err);
          });
        },
      });
      return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }));
    };
  }

  it('returns a timeout error when a 200 body never arrives', { timeout: 2000 }, async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(stalledBody(200) as typeof fetch);
    const client = new Avatcado({ apiKey: MOCK_API_KEY, timeout: 50 });
    const { data, error } = await client.vat.validate({ vatNumber: 'DE123456789' });
    expect(data).toBeNull();
    expect(error!.code).toBe('timeout');
  });

  it('returns a timeout error when an error body never arrives', { timeout: 2000 }, async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(stalledBody(503) as typeof fetch);
    const client = new Avatcado({ apiKey: MOCK_API_KEY, timeout: 50 });
    const { error } = await client.rates.list();
    expect(error!.code).toBe('timeout');
  });
});
