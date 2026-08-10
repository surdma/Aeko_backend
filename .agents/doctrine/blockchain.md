# Blockchain integration

Aeko Backend integrates with AEKO Chain; it does not own validator consensus or protocol changes.

## Boundaries

- AEKO RPC is authoritative for account state and transaction confirmation.
- The explorer is a read/indexing convenience and may lag.
- PostgreSQL owns application workflow and reconciliation status.
- `chain/**` is the current legacy adapter surface.
- `src/infrastructure/blockchain/**` and `src/infrastructure/explorer/**` are the NestJS targets.

## Non-custodial default

1. backend validates user and domain authority;
2. backend builds an unsigned transaction;
3. user's wallet signs;
4. signed transaction is submitted;
5. backend receives the signature and confirms through RPC;
6. backend commits the application state transition;
7. reconciliation verifies explorer indexing.

A service keypair must not silently replace user authorization.

## Transaction correctness

- Use exact program IDs and account ordering from verified chain code.
- Keep lamports and `u64` values as `bigint`.
- Set blockhash expiry and reject stale prepared transactions.
- Simulate or otherwise validate complex transactions where supported.
- Marketplace purchase is releasable only when payment, royalty, platform fee, NFT ownership
  transfer and listing state update are atomic.
- Do not mark a post anchored, NFT minted, reward claimed or stake opened from transaction
  preparation alone.
- Add golden/fixture tests for instruction serialization and account decoding.
