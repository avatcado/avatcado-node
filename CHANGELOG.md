# Changelog

## 0.7.0

### Breaking Changes

- **Node.js 18 is no longer supported.** `engines.node` is now `>=20.19` and CI runs on Node 20 and 22. Node 18 reached end-of-life in April 2025 and the test toolchain (Vite 7) requires Node 20.19+.

### Added

- **Echoed request context on errors.** `AvatcadoError` (and every subclass) now exposes `vatNumber` and `requesterVatNumber` (`string | null`): the normalized VAT numbers from the request, echoed by the API on validation-endpoint errors (`invalid_vat_format`, `validation_error`, rate-limit, upstream and 500 errors). `null` on authentication errors, client-side errors, and responses from older API versions.
- `UpstreamError.validationId` (`string | null`): ID of the recorded failed validation attempt. Present only on `upstream_unavailable` / `upstream_member_state_unavailable`, never in test mode.
- `BatchResultError.error.vatNumber` (`string`): failed batch items now carry the normalized VAT number on the `error` object. The SDK fills it from `meta.vatNumber` for responses from older API versions.

### Changed

- `ValidationError.details` is now an officially documented part of the API error schema (no behaviour change).

### Deprecated

- `BatchResultError.meta.vatNumber` — use `item.error.vatNumber` instead. Still populated; not scheduled for removal.

## 0.6.1

### Changed

- Documentation: updated example API key prefix from `vtly_` to `avat_` to match the new Avatcado key format (README and test fixtures)

## 0.6.0

Rebrand from **Vatly** to **Avatcado**. This is a breaking release — the package, public identifiers, environment variable, and default endpoint all changed. Migrate by reinstalling under the new name and renaming imports/usages.

### Breaking Changes

- **Package renamed** from `@vatly/node` to `@avatcado/node`
- **Default client class** `Vatly` renamed to `Avatcado` (default and named export)
- **Error class** `VatlyError` renamed to `AvatcadoError` (also the static `Avatcado.AvatcadoError`). The `AuthenticationError`, `ValidationError`, `RateLimitError`, and `UpstreamError` subclass names are unchanged.
- **Types** `VatlyOptions` → `AvatcadoOptions`, `VatlyResult<T>` → `AvatcadoResult<T>`
- **Environment variable** `VATLY_API_KEY` → `AVATCADO_API_KEY` (no fallback — set the new name)
- **Default base URL** changed from `https://api.vatly.dev` to `https://api.avatcado.com`
- **User-Agent** header changed from `vatly-node/<version>` to `avatcado-node/<version>`

### Changed

- Homepage and documentation links moved to `avatcado.com` / `docs.avatcado.com`

## 0.5.0

### Added

- **Async validation**: `vatly.vat.validateAsync()` for single async VAT validation (Pro/Business tiers, requires webhook)
- **Async batch validation**: `vatly.vat.validateBatchAsync()` for batch async validation (up to 200 Pro / 1000 Business)
- New types: `AsyncValidateParams`, `AsyncValidateData`, `AsyncMeta`, `AsyncValidateResponse`, `AsyncBatchValidateParams`, `AsyncRejectedItem`, `AsyncBatchValidateData`, `AsyncBatchValidateResponse`
- New error code: `webhook_not_configured`

## 0.4.0

Align SDK types and documentation with Vatly API v1.0 OpenAPI spec. The API now covers 32 countries including CH, LI, NO, and AU.

### Breaking Changes

- **`VatValidationData.consultationNumber`** is now optional (`string | null | undefined` instead of `string | null`). The API may omit this field entirely for CH, LI, NO, and AU validations. Code that checks `data.consultationNumber === null` should also handle `undefined`.

### Added

- **`ClientErrorCode`** type for SDK-internal error codes (`timeout`, `network_error`, `parse_error`, `unknown_error`, `missing_api_key`, `batch_too_large`). These are generated client-side and are separate from the API `ErrorCode` union.

### Changed

- Package description updated to "VAT and GST validation API" to reflect AU/GST support
- README scope updated from "EU and UK" to "32 countries (EU, UK, CH, LI, NO, AU)"
- Keywords expanded with `gst`, `switzerland`, `norway`, `australia`, `vies`, `hmrc`

## 0.3.0

Sync SDK with latest Vatly API surface.

### Added

- **Error codes**: `forbidden`, `key_revoked`, `key_limit_reached`, `upstream_member_state_unavailable`, `internal_error`
- **`sourceStatus`** field on `ResponseMeta` and `BatchItemMeta` (`'live' | 'unavailable' | 'degraded' | null`)
- **Burst rate limit headers**: `burstLimit` and `burstRemaining` on `RateLimitInfo`
- **`error.details`** property on `VatlyError` — surfaces `details` array from 422 `validation_error` responses
- **`BatchResponseMeta`** type — slimmer meta type for batch responses (only `requestId`, `mode`, `requestDurationMs`)

### Changed

- `forbidden` and `key_revoked` now map to `AuthenticationError` (previously `forbidden` fell through to base `VatlyError`)
- `validation_error` and `invalid_json` now map to `ValidationError`
- `upstream_member_state_unavailable` maps to `UpstreamError`
- `OtherRate.type` widened from `'reduced' | 'super_reduced' | 'zero'` to `string`
- `ValidateBatchResponse.meta` now uses `BatchResponseMeta` instead of `ResponseMeta`

### Removed

- `upstream_error` error code (does not exist in API)

## 0.2.0

Complete rewrite of the SDK. This is a breaking release with a new package name.

### Breaking Changes

- **Package renamed** from `vatly` to `@vatly/node`
- **Resource-based API**: methods are now namespaced under `vatly.vat.*` and `vatly.rates.*` instead of flat `vatly.validate()` / `vatly.validateBatch()`
- **`{ data, error }` return pattern**: all methods return a result tuple instead of throwing. Only the constructor still throws (missing API key is a programmer error).
- **Removed `validate()` / `validateRaw()`**: use `vatly.vat.validate(params)` which returns the full response including meta and rate limits
- **Removed `validateBatch()` / `validateBatchRaw()`**: use `vatly.vat.validateBatch(params)` which returns the full response
- **Params are now objects**: `validate({ vatNumber: '...' })` instead of `validate('...', options?)`
- **Batch item structure changed**: each item is now `{ data, meta }` (success) or `{ error, meta }` (error), not flat objects. `isBatchSuccess` checks for `'data'` key instead of `'valid'`.
- **`RateLimitInfo` changed**: removed `burstLimit` and `burstRemaining`, added `retryAfter`
- **`ResponseMeta` changed**: nullable fields use `| null` instead of `?:`, `mode` is `'test' | null` instead of `'test' | 'live'`
- **`VatlyError` changed**: `requestId` is `string | null` (was `string | undefined`), `docsUrl` is `string` with empty default (was `string | undefined`)

### Type Renames

- `VatlyConfig` -> `VatlyOptions`
- `ValidateOptions` -> `ValidateParams`
- `ValidationResult` -> `VatValidationData`
- `VatlyResponse` -> `ValidateResponse`
- `BatchValidateOptions` -> `ValidateBatchParams`
- `VatlyBatchResponse` -> `ValidateBatchResponse`
- `BatchResultItem` -> `BatchResult`

### Added

- `vatly.rates.list()`: list VAT rates for all countries
- `vatly.rates.get(countryCode)`: get VAT rate for a specific country
- `VatlyResult<T>` generic result type
- `ErrorCode` union type with all API error codes
- `BatchItemMeta` type for per-item cache metadata
- `OtherRate`, `VatRate`, `ListRatesResponse`, `GetRateResponse` types

## 0.1.0

Initial release.

- `validate()` and `validateRaw()` for single VAT number validation
- `validateBatch()` and `validateBatchRaw()` for batch validation (up to 50)
- Typed error hierarchy: `AuthenticationError`, `ValidationError`, `RateLimitError`, `UpstreamError`
- `isBatchSuccess()` type guard for batch result discrimination
- Local validation for empty/whitespace inputs (no network call)
- Snake-to-camel response transformation
- Rate limit header parsing with nullable fields
- Configurable timeout and base URL
- Environment variable fallback (`VATLY_API_KEY`)
- Dual CJS/ESM build with full type declarations
- Zero runtime dependencies (native `fetch`)
