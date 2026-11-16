import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Avatcado, { RateLimitError, UpstreamError } from '../src/index.js';

const MOCK_API_KEY = 'avat_live_test123';

const OK_VALIDATE = {
  data: { valid: true, vat_number: 'DE123456789', country_code: 'DE', company: null, requested_at: '2026-11-16T12:00:00Z' },
  meta: { request_id: 'req_ok', source: 'vies', source_status: 'live', cached: false, stale: false },
};
const OK_ASYNC = {
  data: { request_id: 'async_1', status: 'pending', vat_number: 'DE123456789' },
  meta: { request_id: 'req_ok' },
};

function ok(body: unknown) {
  return () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function apiError(status: number, code: string, headers: Record<string, string> = {}) {
  return () =>
    new Response(JSON.stringify({ error: { code, message: code }, meta: { request_id: 'req_err' } }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

function networkFailure() {
  return () => {
    throw new TypeError('fetch failed');
  };
}

function abortFailure() {
  return () => {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
}

/** Queues one outcome per fetch call; the last one repeats. */
function mockSequence(...outcomes: Array<() => Response>) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    return outcome();
  }) as typeof fetch);
}

/** Runs a call to completion while advancing the fake clock through every retry wait. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retries are off by default', () => {
  it('returns the first failure without a second request', async () => {
    const spy = mockSequence(apiError(429, 'burst_limit_exceeded', { 'retry-after': '1' }), ok(OK_VALIDATE));
    const { error } = await settle(new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('maxRetries', () => {
  const client = (maxRetries: number, extra: Record<string, number> = {}) =>
    new Avatcado({ apiKey: MOCK_API_KEY, maxRetries, ...extra });

  it('retries a burst 429 after Retry-After and returns the success', async () => {
    const spy = mockSequence(apiError(429, 'burst_limit_exceeded', { 'retry-after': '3' }), ok(OK_VALIDATE));
    const promise = client(2).vat.validate({ vatNumber: 'DE123456789' });

    await vi.advanceTimersByTimeAsync(2900);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(spy).toHaveBeenCalledTimes(2);

    const { data, error } = await promise;
    expect(error).toBeNull();
    expect(data!.data.valid).toBe(true);
  });

  it('does not retry the monthly quota 429', async () => {
    const spy = mockSequence(apiError(429, 'rate_limit_exceeded', { 'retry-after': '5' }), ok(OK_VALIDATE));
    const { error } = await settle(client(3).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error!.code).toBe('rate_limit_exceeded');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 that carries a short Retry-After', async () => {
    const spy = mockSequence(apiError(503, 'internal_error', { 'retry-after': '5' }), ok(OK_VALIDATE));
    const { error } = await settle(client(1).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns at once when Retry-After is longer than maxRetryDelay', async () => {
    const spy = mockSequence(apiError(503, 'upstream_unavailable', { 'retry-after': '300' }), ok(OK_VALIDATE));
    const { error } = await settle(client(3).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error!.retryAfter).toBe(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('honours a custom maxRetryDelay in milliseconds', async () => {
    const spy = mockSequence(apiError(503, 'upstream_unavailable', { 'retry-after': '300' }), ok(OK_VALIDATE));
    const { error } = await settle(client(1, { maxRetryDelay: 300_000 }).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('stops after maxRetries attempts and returns the last error', async () => {
    const spy = mockSequence(apiError(429, 'burst_limit_exceeded', { 'retry-after': '1' }));
    const { error } = await settle(client(2).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error!.code).toBe('burst_limit_exceeded');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('retries network errors and timeouts on a GET with backoff', async () => {
    const spy = mockSequence(networkFailure(), abortFailure(), ok(OK_VALIDATE));
    const { error } = await settle(client(2).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('waits no longer than 8 seconds between attempts without a Retry-After', async () => {
    const spy = mockSequence(networkFailure());
    const promise = client(6).rates.list();
    // 6 waits, each capped at 8 s
    await vi.advanceTimersByTimeAsync(6 * 8000);
    const { error } = await promise;
    expect(error!.code).toBe('network_error');
    expect(spy).toHaveBeenCalledTimes(7);
  });

  it('retries a 502 and a 504 on a GET', async () => {
    const spy = mockSequence(apiError(502, 'unknown_error'), apiError(504, 'unknown_error'), ok(OK_VALIDATE));
    const { error } = await settle(client(2).vat.validate({ vatNumber: 'DE123456789' }));
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 4xx or a 500', async () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [422, 'invalid_vat_format'],
      [500, 'internal_error'],
    ] as const) {
      const spy = mockSequence(apiError(status, code), ok(OK_VALIDATE));
      const { error } = await settle(client(3).vat.validate({ vatNumber: 'DE123456789' }));
      expect(error!.code).toBe(code);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    }
  });

  // A POST that timed out or lost its connection may have been accepted: retrying could
  // queue the same validation twice.
  it('does not retry a POST after a timeout, a network error, a 502 or a 504', async () => {
    for (const failure of [abortFailure(), networkFailure(), apiError(502, 'unknown_error'), apiError(504, 'unknown_error')]) {
      const spy = mockSequence(failure, ok(OK_ASYNC));
      const { error } = await settle(client(3).vat.validateAsync({ vatNumber: 'DE123456789' }));
      expect(error).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    }
  });

  it('retries a POST on a burst 429 and on a 503, where nothing was processed', async () => {
    const spy = mockSequence(
      apiError(429, 'burst_limit_exceeded', { 'retry-after': '1' }),
      apiError(503, 'internal_error', { 'retry-after': '5' }),
      ok(OK_ASYNC),
    );
    const { error } = await settle(client(2).vat.validateAsync({ vatNumber: 'DE123456789' }));
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('sends the same X-Request-Id on every attempt', async () => {
    const spy = mockSequence(apiError(429, 'burst_limit_exceeded', { 'retry-after': '1' }), ok(OK_VALIDATE));
    await settle(client(1).vat.validate({ vatNumber: 'DE123456789', requestId: 'trace-7' }));
    const ids = spy.mock.calls.map(([, init]) => ((init as RequestInit).headers as Record<string, string>)['X-Request-Id']);
    expect(ids).toEqual(['trace-7', 'trace-7']);
  });

  it('treats a negative or fractional maxRetries as a whole number of at least zero', async () => {
    const spy = mockSequence(apiError(429, 'burst_limit_exceeded', { 'retry-after': '1' }));
    await settle(client(-2).vat.validate({ vatNumber: 'DE123456789' }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await settle(client(1.9).vat.validate({ vatNumber: 'DE123456789' }));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
