# Product and domain truth

Aeko Backend is the centralized application layer for Aeko Social. It coordinates social features,
realtime communication, media, fiat monetization and user-signed operations on AEKO Chain.

## Sources of truth

| Concern | Primary source |
| --- | --- |
| Users, profiles, follows, privacy, feeds, chats, communities and notifications | Application PostgreSQL |
| Passwords, JWT sessions, OAuth links and 2FA state | Backend identity/authentication layer |
| Uploaded media | Cloudinary or the configured media provider |
| Public immutable metadata references | IPFS through the configured provider |
| Fiat payments and subscriptions | Provider result reconciled into PostgreSQL |
| AEKO balances, NFTs, staking and final on-chain ownership | AEKO Chain |
| Searchable chain history | Explorer, after chain confirmation |
| Prepared operation status and application reconciliation | Backend PostgreSQL |

## Domain invariants

- A database flag must not claim an operation is on-chain before RPC confirmation.
- Explorer indexing is eventual and must not replace chain confirmation.
- A private or restricted post must never be uploaded to public IPFS as readable content.
- Minting or anchoring another user's content requires explicit authorization.
- Marketplace purchase must atomically transfer payment, fees, ownership and listing state.
- A user-facing balance must identify whether it is off-chain application credit or on-chain AEKO.
- Realtime delivery is not durable state; PostgreSQL remains authoritative.
