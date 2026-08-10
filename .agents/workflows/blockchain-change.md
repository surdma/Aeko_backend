# Workflow: Blockchain-sensitive change

1. Orchestrator dispatches blockchain integration engineer first.
2. Establish chain program, account layout, authoritative state, signing party and confirmation
   semantics.
3. Model prepare, submit, confirm, reconcile, expiry and failure states.
4. Define exact amounts as `bigint` or decimal strings and verify all fee allocations.
5. Active runtime engineer integrates the typed chain service into Express or NestJS transport.
6. Test serialization/account decoding plus unauthorized, stale, failed and replay cases.
7. For marketplace purchase, prove payment and NFT ownership transfer are atomic.
8. Reviewer blocks release until chain confirmation and database reconciliation are demonstrated.
