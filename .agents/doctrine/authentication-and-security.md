# Authentication and security

## Identity compatibility

During migration, NestJS must validate the same JWT/session contract used by Express until an
explicit auth cutover. Preserve user IDs, claims, expiry, cookie names and OAuth callback behavior.

## Authorization

Authentication is not authorization. Verify:

- resource ownership;
- linked-wallet ownership;
- post visibility;
- block relationships;
- community membership and roles;
- administrator privilege and 2FA requirements;
- payment/subscription ownership;
- permission to anchor, mint, transfer, list, cancel, buy, claim or stake.

Centralize reusable policy checks in guards or policy services, while keeping domain rules in the
owning module.

## Secrets

- No real secret, JWT, API key, seed, keypair or private credential belongs in examples or tests.
- Treat any committed credential as compromised and rotate it.
- Validate configuration at startup.
- Redact secrets and personal data from logs and error responses.
- Service-wallet signing requires explicit task authorization, least privilege and auditable use.

## Privacy

- Public IPFS is permanent public disclosure.
- Restricted content may expose only a non-reversible proof or encrypted reference when the product
  explicitly supports it.
- Upload, anchoring and NFT flows must verify ownership and visibility before preparing a
  transaction.
