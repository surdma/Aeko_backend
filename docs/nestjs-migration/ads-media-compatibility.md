# Ads and media editing compatibility

Scope: the sixteen `ads-media` capabilities — fifteen REST routes plus the `Ad`
model. AdminJS and all UI remain out of scope.

## Route parity

Every legacy path, method, and field name is preserved.

| Route                                  | Notes                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| `POST /api/ads`                        | Created as `pending`, unchanged                          |
| `GET /api/ads`                         | Newest-first owner page, `ads` + `pagination`             |
| `GET /api/ads/targeted`                | Bid-ordered eligible ads, `ads` + `count`                 |
| `GET /api/ads/dashboard`               | `timeRange` still accepted                                |
| `POST /api/ads/track/impression`       | Response `{ impressions, ctr, reach }`                    |
| `POST /api/ads/track/click`            | Response `{ clicks, ctr, budgetSpent, remainingBudget }`  |
| `POST /api/ads/track/conversion`       | Response `{ conversions, conversionRate, budgetSpent }`   |
| `POST /api/ads/track-view`             | Retained alias; identical to `track/impression`           |
| `GET /api/ads/:adId/analytics`         | Owner only                                                |
| `PUT /api/ads/:adId`                   | Allowlisted fields only                                   |
| `DELETE /api/ads/:adId`                | Requires a confirmed two-factor session                   |
| `GET /api/ads/admin/review`            | Defaults to `pending`, 20 per page                        |
| `POST /api/ads/admin/review/:adId`     | Accepts `rejectionReason` and `feedback`                  |
| `POST /api/photo/edit`                 | Field `photo`; **now requires a session**                 |
| `POST /api/video/edit`                 | Field `video`; **now requires a session**                 |

The API field is `status` on every request and response. The canonical database
column `Status` never appears in a response body and is confined to
`src/ads/ad-prisma.client.ts`.

## Changes clients must know about

These follow from the approved corrections in `corrections.json`.

1. **Photo and video editing now require authentication.** The legacy routes
   were mounted with no auth middleware. Anonymous callers receive `401`.
   Client impact: send session credentials on both editing routes.
2. **Uploads are bounded and content-checked.** Images are capped at 10 MiB and
   videos at 100 MiB, and the declared content type must match the file's magic
   bytes. Violations return `400` with a clear message instead of reaching a
   processor.
3. **Rejecting an ad requires a reason.** `POST /api/ads/admin/review/:adId`
   with `status: "rejected"` and no `reason`/`rejectionReason` returns `400`.
   Legacy recorded a rejection with nothing for the advertiser to act on.
4. **Conversion tracking requires a running ad.** Legacy charged CPA against
   paused and completed ads; those requests now return `400`. This is the only
   place a previously successful request changes outcome.
5. **CTR, conversion rate, and frequency are numbers.** Legacy persisted them as
   `toFixed(2)` strings. Clients that did `parseFloat` still work; clients that
   compared against a string will not.
6. **Processor failures return a fixed message.** Sharp and FFmpeg errors,
   which included absolute server paths, are replaced by `503` with
   `Image processing is unavailable.` or `Video processing is unavailable.`
7. **Budget exhaustion completes the ad.** Legacy raised an unknown-argument
   error at this point, so the documented auto-complete never took effect.

## Operational requirements

- `sharp` is a declared dependency. If its native binary cannot load, editing
  returns `503` rather than failing the process.
- FFmpeg is resolved from `FFMPEG_PATH`, defaulting to `ffmpeg` on `PATH`. It is
  invoked with `shell: false`, a fixed argument array, and a 60-second timeout.
  When absent, video editing returns `503`.
- Processed artefacts are written under `uploads/` with generated random names.
  Source copies are removed on every path, including failure and timeout.
- Tracking uses `Serializable` transactions with up to three `P2034` retries. A
  sustained conflict returns `409` with a retryable message.
