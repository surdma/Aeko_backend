# Chat realtime benchmark

## Current status

Blocked before comparative execution. No performance or parity result is
claimed.

The production-backed Nest chat composition bootstrapped successfully on port
`9877` using the configured PostgreSQL database, Redis Socket.IO adapter,
BullMQ delivery worker, transactional outbox dispatcher, Better Auth bearer
sessions, and two isolated benchmark principals. The cutover migration and
benchmark seed both completed successfully.

The legacy Express comparison target could not start because its checkout had
no installed `express` package. Two lockfile restoration attempts using
`npm ci --ignore-scripts` remained silent for several minutes and were
time-boxed. Until that checkout installs successfully, there is no valid legacy
baseline from which to derive the numerical acceptance budget.

The checked-in workload is no longer an HTTP health probe. It connects two
authenticated Socket.IO principals, sends 100 sequential persisted messages,
observes sender acknowledgement and recipient `new_message` delivery, and
matches both sides using the persisted message ID. Raw samples are written
beneath `test/chat-realtime/load/results/`; the report command fails closed if
either sample is absent or Nest exceeds the budget derived from the legacy
sample.

## Next commands

From the legacy checkout, complete its lockfile installation and start
`server.js` on port `9876` with the same benchmark PostgreSQL URL and its own
JWT secret. Then, from this repository, run:

```powershell
corepack pnpm bench:chat:seed
corepack pnpm bench:chat:legacy
corepack pnpm bench:chat:nest
corepack pnpm bench:chat:report
```

After the report passes, run the complete Task 12 programme gate and obtain the
required backend, security, and realtime reviews before release approval.
