# Legacy capability inventory

Source: `C:/Users/olaitan/Dev/aeko/backend`

## Exact counts

- Mounted router modules: 39
- Capabilities: 577
- inactive: 2
- job: 3
- model: 31
- provider: 46
- rest: 287
- socket: 208
- Approved corrections: 16
- Unresolved diagnostics: 0
- Duplicate or shadowed REST pairs: 5

## Owners

- admin-support-jobs: 52
- ads-media: 15
- auth-users-security: 57
- chain: 45
- chat-realtime: 96
- communities: 19
- content-social: 46
- database-foundation: 31
- debates-challenges-spaces: 13
- livestream: 176
- payments-subscriptions: 27

## Risk

- critical: 54
- high: 277
- low: 104
- medium: 142

## Unresolved items

None.

## Duplicate and shadowed routes

- `GET /api/auth/google`: rest:GET:/api/auth/google:routes/auth.js:363, rest:GET:/api/auth/google:routes/auth.js:398
- `GET /api/auth/google/callback`: rest:GET:/api/auth/google/callback:routes/auth.js:368, rest:GET:/api/auth/google/callback:routes/auth.js:405
- `GET /api/posts/mixed`: rest:GET:/api/posts/:postId:routes/postRoutes.js:686, rest:GET:/api/posts/mixed:routes/postRoutes.js:1070
- `GET /api/posts/videos`: rest:GET:/api/posts/:postId:routes/postRoutes.js:686, rest:GET:/api/posts/videos:routes/postRoutes.js:1096
- `POST /api/auth/google/mobile`: rest:POST:/api/auth/google/mobile:routes/auth.js:468, rest:POST:/api/auth/google/mobile:routes/auth.js:595

## Inactive items

- `inactive:routes/adminAuth.js` from `routes/adminAuth.js`
- `inactive:routes/postTransferRoutes.js` from `routes/postTransferRoutes.js`
