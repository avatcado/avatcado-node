# @avatcado/node

Official TypeScript SDK for the [Avatcado](https://avatcado.com) VAT validation API. Validate VAT and GST numbers across 32 countries (EU, UK, CH, LI, NO, AU), look up VAT rates by country. See the full [API reference](https://docs.avatcado.com/api-reference).

## Installation

```bash
npm install @avatcado/node
```

## Quick Start

```typescript
import Avatcado from '@avatcado/node';

const avatcado = new Avatcado('vtly_live_...');

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
  cache: false,                       // optional, bypass cache
  requestId: 'my-trace-id',          // optional, for tracing
});

if (data) {
  console.log(data.data.valid);              // true
  console.log(data.data.vatNumber);          // 'NL123456789B01'
  console.log(data.data.company?.name);      // 'Example BV'
  console.log(data.data.consultationNumber); // null or string
  console.log(data.meta.requestId);          // 'req_abc123'
  console.log(data.meta.sourceStatus);       // 'live' | 'unavailable' | 'degraded' | null
  console.log(data.rateLimit.remaining);     // 99
  console.log(data.rateLimit.burstLimit);    // number or null
  console.log(data.rateLimit.burstRemaining); // number or null
}
```

### `avatcado.vat.validateBatch(params)`

Validate up to 50 VAT numbers in a single request. Returns `{ data, error }`.

```typescript
import Avatcado, { isBatchSuccess } from '@avatcado/node';

const avatcado = new Avatcado('vtly_live_...');
const { data, error } = await avatcado.vat.validateBatch({
  vatNumbers: ['NL123456789B01', 'DE987654321', 'XX000'],
  requesterVatNumber: 'DE987654321', // optional
  cache: false,                       // optional
  requestId: 'my-trace-id',          // optional
});

if (data) {
  console.log(data.data.summary); // { total: 3, succeeded: 2, failed: 1 }

  for (const item of data.data.results) {
    if (isBatchSuccess(item)) {
      console.log(`${item.data.vatNumber} is ${item.data.valid ? 'valid' : 'invalid'}`);
    } else {
      console.log(`${item.meta.vatNumber} failed: ${item.error.message}`);
    }
  }
}
```

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

### `avatcado.rates.list()`

List VAT rates for all supported countries.

```typescript
const { data, error } = await avatcado.rates.list();

if (data) {
  for (const rate of data.data) {
    console.log(`${rate.countryName}: ${rate.standardRate}%`);
  }
}
```

### `avatcado.rates.get(countryCode)`

Get VAT rates for a specific country.

```typescript
const { data, error } = await avatcado.rates.get('NL');

if (data) {
  console.log(data.data.standardRate);  // 21
  console.log(data.data.otherRates);    // [{ rate: 9, type: 'reduced' }, ...]
}
```

## Error Handling

Every method returns `{ data, error }` instead of throwing. The `error` is always a `AvatcadoError` (or subclass). Use `instanceof` to narrow:

```typescript
import Avatcado, { AuthenticationError, RateLimitError, UpstreamError } from '@avatcado/node';

const { data, error } = await avatcado.vat.validate({ vatNumber: 'INVALID' });

if (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof UpstreamError) {
    console.log(`Tax authority unavailable. Retry after ${error.retryAfter}s`);
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
| `ValidationError` | `invalid_vat_format`, `missing_parameter`, `validation_error`, `invalid_json` |
| `RateLimitError` | `rate_limit_exceeded`, `burst_limit_exceeded` |
| `UpstreamError` | `upstream_unavailable`, `upstream_member_state_unavailable` |
| `AvatcadoError` | Base class for all errors, including `timeout`, `network_error`, `parse_error`, `internal_error`, `key_limit_reached` |

### Error Properties

```typescript
error.message    // Human-readable message
error.code       // Machine-readable code (e.g. 'unauthorized', 'rate_limit_exceeded')
error.statusCode // HTTP status (0 for network/timeout errors)
error.requestId  // Request ID (string or null)
error.docsUrl    // Link to error documentation (string, empty if not provided)
error.details    // Validation error details array (Array<{ field, message }> or null)
```

### Retries

The SDK does not retry automatically. `RateLimitError` and `UpstreamError` include a `retryAfter` property (seconds) when the server provides one.

## Test Mode

Use test API keys (`vtly_test_*`) to validate without hitting real tax authorities.

```typescript
const avatcado = new Avatcado('vtly_test_...');
const { data } = await avatcado.vat.validate({ vatNumber: 'NL123456789B01' });
console.log(data?.meta.mode); // 'test'
```

| Magic VAT Number | Result |
|-----------------|--------|
| `NL123456789B01` | Valid, with company info |
| `XX000000000` | Invalid format error |

## Configuration

```typescript
// String API key
const avatcado = new Avatcado('vtly_live_...');

// Config object
const avatcado = new Avatcado({
  apiKey: 'vtly_live_...',
  baseUrl: 'https://api.avatcado.com', // default
  timeout: 30_000,                   // ms, default
});

// Environment variable fallback
// Set AVATCADO_API_KEY=vtly_live_... and pass no key:
const avatcado = new Avatcado({});
```

## TypeScript

All types are exported:

```typescript
import type {
  AvatcadoOptions,
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
  ResponseMeta,
  BatchResponseMeta,
  RateLimitInfo,
  OtherRate,
  VatRate,
  ListRatesResponse,
  GetRateResponse,
} from '@avatcado/node';
import { isBatchSuccess } from '@avatcado/node';
```

## Requirements

- Node.js >= 18 (uses native `fetch`)
- No runtime dependencies

## License

MIT
