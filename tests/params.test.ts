import { describe, it, expect, vi, afterEach } from 'vitest';
import Avatcado from '../src/index.js';

const MOCK_API_KEY = 'avat_live_test123';

const META = { request_id: 'req_1', source: 'vies', source_status: 'live', cached: false, stale: false };
const VAT_DATA = {
  valid: true,
  vat_number: 'DE123456789',
  country_code: 'DE',
  company: null,
  requested_at: '2026-11-16T12:00:00Z',
};

const BODIES: Record<string, unknown> = {
  '/v1/validate': { data: VAT_DATA, meta: META },
  '/v1/validate/batch': {
    data: { results: [{ data: VAT_DATA, meta: META }], summary: { total: 1, succeeded: 1, failed: 0 } },
    meta: { request_id: 'req_1' },
  },
  '/v1/validate/async': {
    data: { request_id: 'async_1', status: 'pending', vat_number: 'DE123456789' },
    meta: { request_id: 'req_1' },
  },
  '/v1/validate/async/batch': {
    data: { batch_id: 'batch_1', status: 'pending', total: 1, accepted: 1, rejected: [] },
    meta: { request_id: 'req_1' },
  },
  '/v1/eori/validate': {
    data: {
      valid: true,
      eori_number: 'GB123456789000',
      country_code: 'GB',
      company: null,
      requested_at: '2026-11-16T12:00:00Z',
    },
    meta: { request_id: 'req_1', source: 'hmrc', source_status: 'live', cached: false, stale: false },
  },
  '/v1/rates': { data: [], meta: { request_id: 'req_1', count: 0 } },
  '/v1/rates/NL': {
    data: {
      country_code: 'NL',
      country_name: 'Netherlands',
      currency: 'EUR',
      standard_rate: 21,
      other_rates: [],
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    meta: { request_id: 'req_1' },
  },
};

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((input: string) => {
    const path = new URL(input).pathname;
    return Promise.resolve(
      new Response(JSON.stringify(BODIES[path]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch);
}

function lastCall(spy: ReturnType<typeof mockApi>) {
  const [input, init] = spy.mock.calls.at(-1) as [string, RequestInit];
  const url = new URL(input);
  return {
    query: Object.fromEntries(url.searchParams),
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    headers: init.headers as Record<string, string>,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// With requester_vat_number the API turns the cache and the register fallback off unless the
// request says cache=true / fallback=true. The SDK therefore has to send an explicit `true`,
// and has to stay silent when the caller set nothing, so the API default applies.
describe('cache and fallback on GET /v1/validate', () => {
  it('sends neither flag when the caller sets neither', async () => {
    const spy = mockApi();
    await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789', requesterVatNumber: 'NL123456789B01' });
    expect(lastCall(spy).query).toEqual({ vat_number: 'DE123456789', requester_vat_number: 'NL123456789B01' });
  });

  it('sends cache=true when the caller opts back in next to a requester', async () => {
    const spy = mockApi();
    await new Avatcado(MOCK_API_KEY).vat.validate({
      vatNumber: 'DE123456789',
      requesterVatNumber: 'NL123456789B01',
      cache: true,
    });
    expect(lastCall(spy).query.cache).toBe('true');
  });

  it('sends cache=false', async () => {
    const spy = mockApi();
    await new Avatcado(MOCK_API_KEY).vat.validate({ vatNumber: 'DE123456789', cache: false });
    expect(lastCall(spy).query.cache).toBe('false');
  });

  it('sends fallback=false and fallback=true', async () => {
    const spy = mockApi();
    const client = new Avatcado(MOCK_API_KEY);
    await client.vat.validate({ vatNumber: 'DE123456789', fallback: false });
    expect(lastCall(spy).query.fallback).toBe('false');
    await client.vat.validate({ vatNumber: 'DE123456789', requesterVatNumber: 'NL123456789B01', fallback: true });
    expect(lastCall(spy).query.fallback).toBe('true');
  });

  it('ignores a flag that is not a boolean', async () => {
    const spy = mockApi();
    await new Avatcado(MOCK_API_KEY).vat.validate({
      vatNumber: 'DE123456789',
      cache: null as unknown as boolean,
      fallback: null as unknown as boolean,
    });
    expect(lastCall(spy).query).toEqual({ vat_number: 'DE123456789' });
  });
});

describe('cache and fallback in POST bodies', () => {
  const posts: Array<[string, (client: Avatcado, flags: { cache?: boolean; fallback?: boolean }) => Promise<unknown>]> = [
    ['vat.validateBatch', (c, flags) => c.vat.validateBatch({ vatNumbers: ['DE123456789'], ...flags })],
    ['vat.validateAsync', (c, flags) => c.vat.validateAsync({ vatNumber: 'DE123456789', ...flags })],
    ['vat.validateBatchAsync', (c, flags) => c.vat.validateBatchAsync({ vatNumbers: ['DE123456789'], ...flags })],
  ];

  for (const [name, call] of posts) {
    it(`${name}: omits both flags by default`, async () => {
      const spy = mockApi();
      await call(new Avatcado(MOCK_API_KEY), {});
      const body = lastCall(spy).body!;
      expect(body).not.toHaveProperty('cache');
      expect(body).not.toHaveProperty('fallback');
    });

    it(`${name}: sends explicit true and false as booleans`, async () => {
      const spy = mockApi();
      const client = new Avatcado(MOCK_API_KEY);
      await call(client, { cache: true, fallback: false });
      expect(lastCall(spy).body).toMatchObject({ cache: true, fallback: false });
      await call(client, { cache: false, fallback: true });
      expect(lastCall(spy).body).toMatchObject({ cache: false, fallback: true });
    });
  }
});

describe('cache on GET /v1/eori/validate', () => {
  it('sends the flag only when set', async () => {
    const spy = mockApi();
    const client = new Avatcado(MOCK_API_KEY);
    await client.eori.validate({ eoriNumber: 'GB123456789000' });
    expect(lastCall(spy).query).toEqual({ eori_number: 'GB123456789000' });
    await client.eori.validate({ eoriNumber: 'GB123456789000', cache: true });
    expect(lastCall(spy).query.cache).toBe('true');
    await client.eori.validate({ eoriNumber: 'GB123456789000', cache: false });
    expect(lastCall(spy).query.cache).toBe('false');
  });
});

describe('request id on rates calls', () => {
  it('rates.list sends X-Request-Id when given', async () => {
    const spy = mockApi();
    const client = new Avatcado(MOCK_API_KEY);
    await client.rates.list();
    expect(lastCall(spy).headers['X-Request-Id']).toBeUndefined();
    await client.rates.list({ requestId: 'my-trace-1' });
    expect(lastCall(spy).headers['X-Request-Id']).toBe('my-trace-1');
  });

  it('rates.get sends X-Request-Id when given', async () => {
    const spy = mockApi();
    await new Avatcado(MOCK_API_KEY).rates.get('NL', { requestId: 'my-trace-2' });
    expect(lastCall(spy).headers['X-Request-Id']).toBe('my-trace-2');
  });
});
