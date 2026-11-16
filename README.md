# @avatcado/node

Official TypeScript SDK for the [Avatcado](https://avatcado.com) VAT validation API. Validate VAT and GST numbers across 32 countries (EU, UK, CH, LI, NO, AU), look up VAT rates by country, and check EORI numbers for the EU, Northern Ireland and Great Britain. See the full [API reference](https://docs.avatcado.com/api-reference).

## Installation

```bash
npm install @avatcado/node
```

## Quick Start

```typescript
import Avatcado from '@avatcado/node';

const avatcado = new Avatcado('avat_live_...');

const { data, error } = await avatcado.vat.validate({ vatNumber: 'NL123456789B01' });

if (error) {
  console.error(error.message, error.code);
} else {
  console.log(data.data.valid, data.data.company?.name);
}
```

## Usage

### `avatcado.vat.validate(params)`

Validate a single VAT number. Returns `{ data, error }`.

```typescript
const { data, error } = await avatcado.vat.validate({
  vatNumber: 'NL123456789B01',
  requesterVatNumber: 'DE987654321', // optional, for consultation number
  cache: false,                       // optional, see "Cache and fallback"
  fallback: false,                    // optional, see "Cache and fallback"
  requestId: 'my-trace-id',          // optional, for tracing
});

if (data) {
  console.log(data.data.valid);              // true
  console.log(data.data.vatNumber);          // 'NL123456789B01'
  console.log(data.data.company?.name);      // 'Example BV'
  console.log(data.data.consultationNumber); // null or string (EU/UK only; never on fallback)
  console.log(data.meta.requestId);          // 'req_abc123'
  console.log(data.meta.source);             // 'vies', 'hmrc', ... or e.g. 'anaf' on fallback
  console.log(data.meta.sourceStatus);       // 'live' | 'cached' | 'unavailable' | 'degraded' | 'fallback'
  console.log(data.meta.cached);             // true/false (null on older API versions)
  console.log(data.meta.stale);              // true/false (null on older API versions)
  console.log(data.meta.cachedAt);           // ISO timestamp when cached, else null
  console.log(data.rateLimit.remaining);     // 99
  console.log(data.rateLimit.burstLimit);    // number or null
  console.log(data.rateLimit.burstRemaining); // number or null
}
```

#### Source and fallback

`meta.source` names the registry that produced the served data: `vies`, `hmrc`, `bfs`, `brreg`, `abr`, or `test` in test mode. When VIES is down for a member state, the API consults that country's national register before falling back to stale cache (Pro and Business plans); `source` then names the register (`anaf`, `ares`, `dgfip`, `fssr`, `furs`, `kbo`, `porezna`, `prh`, `rik`, `vid`) and `sourceStatus` is `'fallback'`. `source` is a plain string, not an enum: new registers appear without an SDK release.

| Scenario | `sourceStatus` | `cached` | `stale` | `cachedAt` |
|---|---|---|---|---|
| Fresh upstream result | `'live'` | `false` | `false` | `null` |
| Cache hit (within 25-day TTL) | `'cached'` | `true` | `false` | set |
| Upstream down, cached row within TTL served | `'unavailable'` | `true` | `false` | set |
| Upstream down, row beyond TTL served | `'unavailable'` | `true` | `true` | set |
| VIES returned a suspected false negative, prior row served | `'degraded'` | `true` | varies | set |
| VIES down, national register answered | `'fallback'` | `false` | `false` | `null` |

Fallback responses never carry a `consultationNumber` (national registers cannot issue one, even with `requesterVatNumber`), and `valid` there means the number is registered for domestic VAT. Some registers publish less than VIES: Latvia (`vid`) returns the company name only, so `company.address` is `null`, and Croatia (`porezna`) returns no company at all. The [supported countries page](https://docs.avatcado.com/supported-countries) lists every register. Fallback and stale responses count toward your quota because data was served; only `503` upstream errors are refunded. API versions that predate these fields omit them, in which case they are `null`.

#### Cache and fallback

Leave `cache` and `fallback` unset to get the API defaults. Both are on by default, and both switch off when you pass `requesterVatNumber`, so a consultation number always comes from a fresh VIES or HMRC check.

| Option | Effect |
|---|---|
| `cache: false` | Skip the cache and ask the registry again |
| `cache: true` with a requester | Accept a cached or stored result next to `requesterVatNumber` |
| `fallback: false` | Never answer a VIES outage from a national register |
| `fallback: true` with a requester | Accept a national register answer, which carries no consultation number |

`fallback` applies on Pro and Business plans and is ignored on Free. The same two options exist on `validateBatch`, `validateAsync` and `validateBatchAsync`.

```typescript
// A consultation number when VIES answers, the stored result when it does not
const { data } = await avatcado.vat.validate({
  vatNumber: 'NL123456789B01',
  requesterVatNumber: 'DE987654321',
  cache: true,
});
```

### `avatcado.vat.validateBatch(params)`

Validate up to 50 VAT numbers in a single request. Returns `{ data, error }`.

```typescript
import Avatcado, { isBatchSuccess } from '@avatcado/node';

const avatcado = new Avatcado('avat_live_...');
const { data, error } = await avatcado.vat.validateBatch({
  vatNumbers: ['NL123456789B01', 'DE987654321', 'XX000'],
  requesterVatNumber: 'DE987654321', // optional
  cache: false,                       // optional
  fallback: false,                    // optional
  requestId: 'my-trace-id',          // optional
});

if (data) {
  console.log(data.data.summary); // { total: 3, succeeded: 2, failed: 1 }

  for (const item of data.data.results) {
    if (isBatchSuccess(item)) {
      console.log(`${item.data.vatNumber} is ${item.data.valid ? 'valid' : 'invalid'}`);
    } else {
      console.log(`${item.error.vatNumber} failed: ${item.error.message}`);
    }
  }
}
```

`item.meta.vatNumber` is deprecated in favour of `item.error.vatNumber`. The SDK fills `error.vatNumber` from `meta` for responses from older API versions, so `item.error.vatNumber` is always set.

Successful items expose the same `meta.source`, `meta.sourceStatus`, `meta.cached`, `meta.stale` and `meta.cachedAt` as a single validation; see [Source and fallback](#source-and-fallback). Items never carry `requestId` or `mode`; those live on the batch envelope.

### Async Validation

Submit a VAT number for asynchronous validation. The result is delivered to your configured [webhook URL](https://docs.avatcado.com/webhooks). Requires a Pro or Business plan.

```typescript
const { data, error } = await avatcado.vat.validateAsync({
  vatNumber: 'DE123456789',
});

if (error) {
  console.error(error.code); // e.g. 'webhook_not_configured'
} else {
  console.log(data.data.requestId); // UUID to correlate with webhook delivery
  console.log(data.data.status);    // 'pending'
}
```

### Async Batch Validation

Submit multiple VAT numbers for asynchronous validation. Pro tier supports up to 200 items, Business up to 1,000. Items with invalid formats are rejected immediately and never queued.

```typescript
const { data, error } = await avatcado.vat.validateBatchAsync({
  vatNumbers: ['DE123456789', 'NL987654321B01', 'XX000'],
});

if (error) {
  console.error(error.message);
} else {
  console.log(data.data.batchId);  // UUID (null if all rejected)
  console.log(data.data.status);   // 'pending' or 'completed'
  console.log(data.data.accepted); // 2
  console.log(data.data.rejected); // [{ vatNumber: 'XX000', error: { code, message } }]
}
```

### `avatcado.rates.list(options?)`

List VAT rates for all supported countries. Both rates calls accept `{ requestId }` as an optional last argument.

```typescript
const { data, error } = await avatcado.rates.list();

if (data) {
  for (const rate of data.data) {
    console.log(`${rate.countryName}: ${rate.standardRate}%`);
  }
}
```

### `avatcado.rates.get(countryCode, options?)`

Get VAT rates for a specific country.

```typescript
const { data, error } = await avatcado.rates.get('NL');

if (data) {
  console.log(data.data.standardRate);  // 21
  console.log(data.data.otherRates);    // [{ rate: 9, type: 'reduced' }, ...]
}
```

### `avatcado.eori.validate(params)`

Check an EORI number (the customs identifier a business needs to import or export goods). GB numbers are checked with HMRC; numbers from the 27 EU member states and XI are checked with the European Commission's EORI validation service. An EORI number is a separate registration from a VAT number.

```typescript
const { data, error } = await avatcado.eori.validate({
  eoriNumber: 'GB123456789000',
  cache: false, // optional: skip the cache and ask the register again
});

if (data) {
  console.log(data.data.valid);          // true
  console.log(data.data.eoriNumber);     // 'GB123456789000'
  console.log(data.data.company?.name);  // undefined when the holder published no details
  console.log(data.meta.source);         // 'hmrc' or 'ec_eos'
  console.log(data.meta.sourceStatus);   // 'live', 'cached' or 'unavailable'
}
```

`company` is `null` for many valid numbers: both registers publish a name and address only when the holder consented. Spaces, dots, dashes and casing in `eoriNumber` are normalized by the API, and a Greek number sent with the VAT prefix `EL` is checked under the EORI prefix `GR`.

When the register is down, the API serves the most recent stored answer with `sourceStatus` `'unavailable'`, or returns an `UpstreamError` when it has none. With `cache: false` a stored answer is never served.

A malformed number returns a `ValidationError` with code `invalid_eori_format`. One number per call; there is no batch or async variant.

## Error Handling

Every method returns `{ data, error }` instead of throwing. The `error` is always a `AvatcadoError` (or subclass). Use `instanceof` to narrow:

```typescript
import Avatcado, { AuthenticationError, RateLimitError, UpstreamError } from '@avatcado/node';

const { data, error } = await avatcado.vat.validate({ vatNumber: 'INVALID' });

if (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof UpstreamError) {
    console.log(`Tax authority unavailable for ${error.vatNumber}. Retry after ${error.retryAfter}s`);
    console.log(`Recorded validation attempt: ${error.validationId}`); // null in test mode
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key or insufficient plan');
  } else {
    console.log(error.message, error.code, error.statusCode);
    console.log(error.requestId, error.docsUrl);
  }
}
```

### Error Classes

| Class | Trigger |
|-------|---------|
| `AuthenticationError` | `unauthorized`, `tier_insufficient`, `forbidden`, `key_revoked` |
| `ValidationError` | `invalid_vat_format`, `invalid_eori_format`, `missing_parameter`, `validation_error`, `invalid_json` |
| `RateLimitError` | `rate_limit_exceeded`, `burst_limit_exceeded` |
| `UpstreamError` | `upstream_unavailable`, `upstream_member_state_unavailable` |
| `AvatcadoError` | Base class for all errors, including `timeout`, `network_error`, `parse_error`, `unknown_error`, `internal_error`, `not_found`, `webhook_not_configured` |

### Error Properties

```typescript
error.message            // Human-readable message
error.code               // Machine-readable code (e.g. 'unauthorized', 'rate_limit_exceeded')
error.statusCode         // HTTP status (0 for network/timeout errors)
error.requestId          // Request ID (string or null)
error.docsUrl            // Link to error documentation (string, empty if not provided)
error.details            // Validation error details (Array<{ field, message }> or null)
error.vatNumber          // Normalized VAT number from the request, echoed on validation errors (string or null)
error.requesterVatNumber // Normalized requester VAT number, when one was supplied (string or null)
error.eoriNumber          // Normalized EORI number, echoed on errors from eori.validate() (string or null)
error.retryAfter         // Seconds from the Retry-After header (number or null)
```

`vatNumber` / `requesterVatNumber` are echoed by the API on validation-endpoint errors (`invalid_vat_format`, `validation_error`, rate-limit, upstream and 500 errors). They are `null` on authentication errors, on client-side errors (`timeout`, `network_error`, `missing_parameter`, …), and on responses from older API versions.

`UpstreamError` additionally exposes `validationId` (string or null): the ID of the recorded failed validation attempt. Present only on `upstream_unavailable` / `upstream_member_state_unavailable`, never in test mode.

A response that is not JSON (a gateway answering for the API) comes back as `unknown_error` with the HTTP status, and still carries `requestId` and `retryAfter` from the headers. A `2xx` body that does not have the documented shape comes back as `parse_error`. No method throws.

### Timeouts and retries

`timeout` is per attempt and covers the request and the response body. The default is 30 seconds. A single validation normally answers in one to three seconds, but when VIES is slow the API keeps retrying it on your behalf and can take longer than 30 seconds to answer. The SDK then returns a `timeout` error with `statusCode` 0. Raise `timeout` if you would rather wait, or set `maxRetries` to have the SDK try again.

Retries are off by default. Set `maxRetries` to turn them on:

```typescript
const avatcado = new Avatcado({
  apiKey: 'avat_live_...',
  maxRetries: 2,          // extra attempts, default 0
  maxRetryDelay: 60_000,  // ms, longest wait before one retry, default 60000
});
```

| Failure | Retried on |
|---|---|
| `burst_limit_exceeded` (429) | every method |
| any `503` | every method |
| `timeout`, `network_error`, `502`, `504` | GET only: `vat.validate`, `rates.list`, `rates.get`, `eori.validate` |
| everything else, including `rate_limit_exceeded` | never |

A POST that timed out may already have been accepted, so `validateBatch`, `validateAsync` and `validateBatchAsync` are not retried after a timeout or a dropped connection.

The SDK waits for `Retry-After` when the API sends it, and otherwise 0.5 seconds doubling up to 8 seconds, with jitter. An error whose `Retry-After` is longer than `maxRetryDelay` is returned at once: the monthly quota, and a register outage, where the API asks for 300 seconds. Every error exposes `retryAfter` (seconds, or `null`), so you can schedule those yourself.

## Test Mode

Use test API keys (`avat_test_*`) to validate without hitting real tax authorities.

```typescript
const avatcado = new Avatcado('avat_test_...');
const { data } = await avatcado.vat.validate({ vatNumber: 'NL123456789B01' });
console.log(data?.meta.mode); // 'test'
```

| Magic VAT Number | Result |
|-----------------|--------|
| `NL123456789B01` | Valid, with company info |
| `XX000000000` | Invalid format error |
| `DE555555555` | Valid, served from stale cache: `sourceStatus` `'unavailable'`, `stale` `true` |
| `RO555555555` | Valid via national registry fallback: `source` `'anaf'`, `sourceStatus` `'fallback'`, no consultation number |

`eori.validate()` has its own test numbers: `NL111111111` (valid, with company), `NL222222222` (valid, `company` `null`), `NL000000000` (not valid) and `NL999999999` (`upstream_unavailable`).

See the [test mode docs](https://docs.avatcado.com/test-mode) for the full list of magic numbers.

## Development

```bash
npm test            # unit tests, HTTP mocked
npm run typecheck
npm run build
```

`tests/live.test.ts` runs the SDK against a real API in test mode. It is skipped unless a test key is set:

```bash
AVATCADO_TEST_API_KEY=avat_test_... npm test
```

Test keys use no quota and never reach a tax authority. Set `AVATCADO_BASE_URL` to point the suite at another host.

## Configuration

```typescript
// String API key
const avatcado = new Avatcado('avat_live_...');

// Config object
const avatcado = new Avatcado({
  apiKey: 'avat_live_...',
  baseUrl: 'https://api.avatcado.com', // default
  timeout: 30_000,                   // ms per attempt, default
  maxRetries: 0,                     // default, see "Timeouts and retries"
  maxRetryDelay: 60_000,             // ms, default
});

// Environment variable fallback
// Set AVATCADO_API_KEY=avat_live_... and pass no key:
const avatcado = new Avatcado({});
```

## TypeScript

All types are exported:

```typescript
import type {
  AvatcadoOptions,
  RequestOptions,
  ValidationFlags,
  AvatcadoResult,
  ErrorCode,
  ClientErrorCode,
  ValidateParams,
  VatValidationData,
  ValidateResponse,
  ValidateBatchParams,
  ValidateBatchResponse,
  AsyncValidateParams,
  AsyncValidateData,
  AsyncMeta,
  AsyncValidateResponse,
  AsyncBatchValidateParams,
  AsyncRejectedItem,
  AsyncBatchValidateData,
  AsyncBatchValidateResponse,
  BatchResult,
  BatchResultSuccess,
  BatchResultError,
  BatchItemMeta,
  BatchSummary,
  Company,
  SourceStatus,
  ValidationResultMeta,
  ResponseMeta,
  BatchResponseMeta,
  RateLimitInfo,
  OtherRate,
  VatRate,
  ListRatesResponse,
  GetRateResponse,
  EoriValidateParams,
  EoriValidationData,
  EoriSourceStatus,
  EoriResponseMeta,
  EoriValidateResponse,
} from '@avatcado/node';
import { isBatchSuccess } from '@avatcado/node';
```

## Requirements

- Node.js >= 20.19 (uses native `fetch`)
- No runtime dependencies

## License

MIT
