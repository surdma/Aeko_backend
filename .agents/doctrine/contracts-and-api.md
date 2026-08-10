# Contracts and API

## Compatibility

Migration preserves existing externally observable behavior unless the task explicitly versions it:

- method and path;
- authentication and cookie/header behavior;
- request fields and upload names;
- status code;
- response envelope and property names;
- pagination;
- OAuth callback path;
- webhook URL;
- Socket.IO namespace, event name and payload.

## Schemas

- Define boundary schemas with Zod.
- Derive TypeScript types and Nest DTO integration from the schema.
- Do not maintain separate hand-written runtime validators and TypeScript interfaces.
- Generate OpenAPI from the active Nest contracts.
- Validate path parameters, query parameters, bodies, headers and provider callbacks.

## Errors

Use stable public codes and user-safe messages. The preferred target shape is:

```json
{
  "success": false,
  "error": {
    "code": "POST_NOT_FOUND",
    "message": "The requested post could not be found",
    "details": null,
    "requestId": "req_123"
  }
}
```

During migration, preserve the legacy envelope where consumers require it and map internal errors
centrally. Never expose Prisma, SQL, stack, RPC-decoding or provider-secret details.

## Writes

- Require idempotency for payment, webhook and on-chain preparation/confirmation operations.
- Separate prepare, submit and confirm semantics.
- Do not return success before the authoritative state transition completes.
