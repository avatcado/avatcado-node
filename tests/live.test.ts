import { describe, it, expect } from 'vitest';
import Avatcado, {
  AuthenticationError,
  RateLimitError,
  UpstreamError,
  ValidationError,
  isBatchSuccess,
} from '../src/index.js';

// Runs the SDK against a real Avatcado API in test mode. Test keys never reach a register and
// use no quota, and the magic numbers below give fixed answers (https://docs.avatcado.com/test-mode).
//
//   AVATCADO_TEST_API_KEY=avat_test_... npm test
//   AVATCADO_BASE_URL=http://localhost:8787   (optional, for a locally running API)
//
// Skipped when AVATCADO_TEST_API_KEY is not set.
const KEY = process.env.AVATCADO_TEST_API_KEY ?? '';
const BASE_URL = process.env.AVATCADO_BASE_URL;
const REQUESTER = 'NL123456789B01';

function client(apiKey = KEY, extra: { maxRetries?: number } = {}) {
  return new Avatcado({ apiKey, ...(BASE_URL ? { baseUrl: BASE_URL } : {}), ...extra });
}

describe.skipIf(!KEY)('live API in test mode', () => {
  it('runs with a test key only', () => {
    expect(KEY).toMatch(/^(avat|vtly)_test_/);
  });

  describe('vat.validate', () => {
    it('returns a valid number with company details and test-mode meta', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'de 111.111.111', requestId: 'sdk-live-1' });
      expect(error).toBeNull();
      expect(data!.data).toMatchObject({
        valid: true,
        vatNumber: 'DE111111111',
        countryCode: 'DE',
        company: { name: 'Test GmbH' },
      });
      expect(typeof data!.data.requestedAt).toBe('string');
      expect(data!.meta.requestId).toBe('sdk-live-1');
      expect(data!.meta.mode).toBe('test');
      // Test keys carry no quota, so the API sends no rate limit headers.
      expect(data!.rateLimit.limit).toBeNull();
    });

    it('returns valid: false with a null company for an invalid number', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'DE000000000' });
      expect(error).toBeNull();
      expect(data!.data.valid).toBe(false);
      expect(data!.data.company).toBeNull();
    });

    it('returns a null company for a valid number without details', async () => {
      const { data } = await client().vat.validate({ vatNumber: 'DE222222222' });
      expect(data!.data.valid).toBe(true);
      expect(data!.data.company).toBeNull();
    });

    it('maps a malformed number to a ValidationError that echoes the number', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'DE123' });
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(ValidationError);
      expect(error!.code).toBe('invalid_vat_format');
      expect(error!.statusCode).toBe(422);
      expect(error!.vatNumber).toBe('DE123');
      expect(error!.docsUrl).toContain('/errors/invalid_vat_format');
      expect(error!.requestId).toBeTruthy();
    });

    it('maps a register outage to an UpstreamError', async () => {
      const { error } = await client().vat.validate({ vatNumber: 'DE999999999' });
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error!.code).toBe('upstream_unavailable');
      expect(error!.statusCode).toBe(503);
      expect(error!.vatNumber).toBe('DE999999999');
    });

    it('maps the quota and burst limits to a RateLimitError', async () => {
      const quota = await client().vat.validate({ vatNumber: 'DE777777777' });
      expect(quota.error).toBeInstanceOf(RateLimitError);
      expect(quota.error!.code).toBe('rate_limit_exceeded');

      const burst = await client().vat.validate({ vatNumber: 'DE666666666' });
      expect(burst.error).toBeInstanceOf(RateLimitError);
      expect(burst.error!.code).toBe('burst_limit_exceeded');
    });

    it('serves a stored result during an outage, marked unavailable and stale', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'DE555555555' });
      expect(error).toBeNull();
      expect(data!.meta.sourceStatus).toBe('unavailable');
      expect(data!.meta.cached).toBe(true);
      expect(typeof data!.meta.cachedAt).toBe('string');
    });

    // With a requester the API serves no stored result unless the request says cache=true.
    // This is the case the SDK could not express before it sent an explicit `cache: true`.
    it('with a requester: 503 by default, the stored result with cache: true', async () => {
      const byDefault = await client().vat.validate({ vatNumber: 'DE555555555', requesterVatNumber: REQUESTER });
      expect(byDefault.error).toBeInstanceOf(UpstreamError);
      expect(byDefault.error!.code).toBe('upstream_member_state_unavailable');
      expect(byDefault.error!.requesterVatNumber).toBe(REQUESTER);

      const optedIn = await client().vat.validate({
        vatNumber: 'DE555555555',
        requesterVatNumber: REQUESTER,
        cache: true,
      });
      expect(optedIn.error).toBeNull();
      expect(optedIn.data!.meta.sourceStatus).toBe('unavailable');
    });

    it('fallback: false never returns a national register answer', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'RO555555555', fallback: false });
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error!.code).toBe('upstream_member_state_unavailable');
    });

    it('by default answers from the register on Pro and Business, and with a 503 on Free', async () => {
      const { data, error } = await client().vat.validate({ vatNumber: 'RO555555555' });
      if (error) {
        expect(error.code).toBe('upstream_member_state_unavailable');
      } else {
        expect(data!.meta.sourceStatus).toBe('fallback');
        expect(data!.meta.source).toBe('anaf');
      }
    });
  });

  describe('vat.validateBatch', () => {
    it('returns one result per number on Pro and Business, tier_insufficient on Free', async () => {
      const { data, error } = await client().vat.validateBatch({ vatNumbers: ['DE111111111', 'DE000000000', 'DE999999999'] });
      if (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error.code).toBe('tier_insufficient');
        return;
      }
      expect(data!.data.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
      const [valid, invalid, outage] = data!.data.results;
      expect(isBatchSuccess(valid) && valid.data.valid).toBe(true);
      expect(isBatchSuccess(valid) && valid.meta.source).toBe('test');
      expect(isBatchSuccess(invalid) && invalid.data.valid).toBe(false);
      // A register outage fails that one item; the batch itself still answers 200.
      expect(isBatchSuccess(outage)).toBe(false);
      if (!isBatchSuccess(outage)) {
        expect(outage.error.code).toBe('upstream_unavailable');
        expect(outage.error.vatNumber).toBe('DE999999999');
      }
    });
  });

  describe('vat.validateAsync', () => {
    it('is refused for a test key with an AuthenticationError', async () => {
      const { data, error } = await client().vat.validateAsync({ vatNumber: 'DE111111111' });
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(['forbidden', 'tier_insufficient']).toContain(error!.code);
    });
  });

  describe('rates', () => {
    it('lists every country with a standard rate', async () => {
      const { data, error } = await client().rates.list({ requestId: 'sdk-live-rates' });
      expect(error).toBeNull();
      expect(data!.data.length).toBeGreaterThan(25);
      expect(data!.meta.count).toBe(data!.data.length);
      expect(data!.meta.requestId).toBe('sdk-live-rates');
      const nl = data!.data.find((rate) => rate.countryCode === 'NL')!;
      expect(nl.countryName).toBe('Netherlands');
      expect(typeof nl.standardRate).toBe('number');
      expect(Array.isArray(nl.otherRates)).toBe(true);
    });

    it('gets one country and reports an unknown one as not_found', async () => {
      const found = await client().rates.get('nl');
      expect(found.error).toBeNull();
      expect(found.data!.data.countryCode).toBe('NL');

      const missing = await client().rates.get('ZZ');
      expect(missing.data).toBeNull();
      expect(missing.error!.statusCode).toBe(404);
      expect(missing.error!.code).toBe('not_found');
    });
  });

  describe('eori.validate', () => {
    it('returns a valid EU number with trader details', async () => {
      const { data, error } = await client().eori.validate({ eoriNumber: 'nl 111.111.111' });
      expect(error).toBeNull();
      expect(data!.data).toMatchObject({ valid: true, eoriNumber: 'NL111111111', countryCode: 'NL' });
      expect(data!.data.company!.name).toBe('Test B.V.');
      expect(data!.meta).toMatchObject({ mode: 'test', source: 'test', sourceStatus: 'live', cached: false });
    });

    it('returns a valid GB number', async () => {
      const { data } = await client().eori.validate({ eoriNumber: 'GB111111111111' });
      expect(data!.data.valid).toBe(true);
      expect(data!.data.countryCode).toBe('GB');
    });

    it('returns a null company for a valid number without published details', async () => {
      const { data } = await client().eori.validate({ eoriNumber: 'NL222222222' });
      expect(data!.data.valid).toBe(true);
      expect(data!.data.company).toBeNull();
    });

    it('returns valid: false for a number the register does not list', async () => {
      const { data } = await client().eori.validate({ eoriNumber: 'NL000000000', cache: false });
      expect(data!.data.valid).toBe(false);
      expect(data!.data.company).toBeNull();
    });

    it('maps a register outage to an UpstreamError that echoes the number', async () => {
      const { error } = await client().eori.validate({ eoriNumber: 'NL999999999' });
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error!.code).toBe('upstream_unavailable');
      expect(error!.eoriNumber).toBe('NL999999999');
    });

    it('maps a malformed number to a ValidationError that echoes the number', async () => {
      const { error } = await client().eori.validate({ eoriNumber: 'GB12' });
      expect(error).toBeInstanceOf(ValidationError);
      expect(error!.code).toBe('invalid_eori_format');
      expect(error!.statusCode).toBe(422);
      expect(error!.eoriNumber).toBe('GB12');
    });
  });

  describe('authentication', () => {
    it('maps an unknown key to an AuthenticationError', async () => {
      const { data, error } = await client('avat_test_0000000000000000000000000000000000000000').rates.list();
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error!.code).toBe('unauthorized');
      expect(error!.statusCode).toBe(401);
    });
  });
});
