# Time-Off Microservice

Time-Off Microservice is a NestJS-based service for handling:

- Employee time-off balances
- Time-off request lifecycle (create, approve, reject)
- HCM integration (balance validation/update + batch sync)

The service is built with TypeScript, TypeORM, and SQLite, with resilient patterns such as idempotency keys, retry handling for transient HCM failures, and protected sync endpoints.

## Project Overview

### Core modules

- `EmployeeBalance`: stores and queries employee/location balances
- `TimeOffRequest`: handles request creation, approval, rejection, and business rules
- `HCMIntegration`: integrates with HCM APIs or mock mode, and supports batch sync

### Key capabilities

- Idempotent request creation (`idempotencyKey`)
- Approval operation tracking (`approvalOperationId`)
- Transient-only retries for HCM API calls
- Protected `/hcm/sync` endpoint with service token (and optional signature verification)
- Timestamp-aware batch sync to prevent stale overwrites

## Architecture Rationale

This service uses a modular NestJS architecture (`EmployeeBalance`, `TimeOffRequest`, `HCMIntegration`) to keep domain logic isolated while allowing clear orchestration paths.

- `TimeOffRequest` owns request state transitions and business invariants.
- `HCMIntegration` owns external-system communication and integration-event logging.
- `EmployeeBalance` owns local balance persistence and lookup.

Why this architecture was chosen:

- Clear separation of concerns without introducing heavy infrastructure too early.
- Predictable ownership per module, which is easier to scale into separate services later.
- Pragmatic production readiness: idempotency + retries + guarded sync endpoint.

## Consistency With HCM

Consistency is maintained with an operation-oriented flow:

1. Request is moved to `approval_in_progress` and persisted locally first.
2. HCM balance validation is executed.
3. HCM balance update is executed.
4. Local transaction finalizes to `approved` and deducts local balance.

This sequence ensures retries and replays are safe via `approvalOperationId`, and avoids duplicate external side effects.

Integration events are recorded for HCM operations and failures to support traceability and operational recovery.

## Trade-offs and Assumptions

### Trade-offs

- The service currently uses a pragmatic orchestration approach instead of a full saga/outbox implementation to keep complexity manageable.
- SQLite is used for simplicity and local portability; production can migrate to a stronger RDBMS with minimal domain changes.
- Reference-based links (`employeeId`, `locationId`) are used instead of deep relational coupling to keep microservice boundaries flexible.

### Assumptions

- HCM is the source of truth for externally synced balance updates.
- Sync payload timestamps are trustworthy enough to resolve staleness.
- Clients provide stable idempotency/approval operation keys when retrying.

### Future hardening options

- Introduce outbox/saga orchestration for stronger cross-system consistency guarantees.
- Add rate limiting/throttling and stricter API gateway controls.
- Add dead-letter handling and automated reconciliation jobs for long-running failures.

## Validation and Error Handling

### Request validation

- Global NestJS `ValidationPipe` is enabled with:
  - `whitelist: true`
  - `transform: true`
  - `forbidNonWhitelisted: true`
- DTO-based validation is applied for request payloads (create/approve/reject/sync).

### Error handling strategy

- Business rule violations return clear HTTP errors:
  - `400` invalid input
  - `401` unauthorized sync call
  - `404` missing resources
  - `409` conflicts (insufficient balance, duplicate/idempotency mismatch, invalid state transitions)
  - `503` transient external HCM failures
- HCM integration failures and operational events are logged in `hcm_integration_events`.

## Database Design

- Database: SQLite (TypeORM)
- Numeric precision strategy:
  - day/balance values are stored as fixed-point integers (scale `1000`) via transformer
  - API still uses standard decimal numbers

### Main entities

- `EmployeeBalance`
  - `id`, `employeeId`, `locationId`, `balance`, `lastSyncedAt`
- `TimeOffRequest`
  - `id`, `employeeId`, `locationId`, `daysRequested`, `status`
  - `idempotencyKey`, `approvalOperationId`, `pendingRequestKey`
  - `createdAt`, `updatedAt`
- `HCMIntegrationEvent`
  - `id`, `eventType`, `payload`, `status`, `errorMessage`, `createdAt`

### Relationships

- Current design is reference-based (via `employeeId` + `locationId`) instead of direct foreign-key relations.
- This keeps module boundaries simple for microservice-oriented ownership.

### Indexing and constraints

- Unique: `employee_balances(employeeId, locationId)`
- Unique: `time_off_requests(idempotencyKey)`
- Unique: `time_off_requests(pendingRequestKey)` for active duplicate-prevention
- Indexed lookups on request status, employee/location combinations, and approval operation IDs

## Setup Instructions

### 1) Prerequisites

- Node.js 18+ (recommended)
- npm 9+

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment

Copy `.env.example` to `.env` and update values as needed.

```bash
cp .env.example .env
```

Required/important environment variables:

- `PORT`: service port (default `3000`)
- `DB_PATH`: SQLite file path (default `data/time-off.sqlite`)
- `DB_SYNCHRONIZE`: set `true` for local dev, `false` for production
- `HCM_INTEGRATION_MODE`: `mock` or `api`
- `HCM_BASE_URL`: required for API integration mode
- `HCM_SYNC_SERVICE_TOKEN`: required token for `/api/hcm/sync`
- `HCM_SYNC_SIGNING_SECRET`: optional HMAC signing secret for sync requests

## How To Run The Project

### Development

```bash
npm run start:dev
```

### Production build and run

```bash
npm run build
npm run start:prod
```

Service base URL (default): `http://localhost:3000`  
Global API prefix: `/api`

## How To Run Tests

### Unit tests

```bash
npm run test
```

### Integration / e2e tests

```bash
npm run test:e2e
```

### Coverage report

```bash
npm run test:cov
```

Coverage reports are generated in `coverage/` (text, HTML, and lcov).

## API Documentation

All endpoints are prefixed with `/api`.

### Health

- `GET /health`
  - Returns service health payload.
  - Response:
    ```json
    {
      "status": "ok",
      "service": "time-off-microservice"
    }
    ```

### Employee Balances

- `GET /employee-balances`
  - Lists all employee balances.
  - Response:
    ```json
    [
      {
        "id": "uuid",
        "employeeId": "emp-001",
        "locationId": "loc-nyc",
        "balance": 12.5,
        "lastSyncedAt": "2026-04-24T00:00:00.000Z"
      }
    ]
    ```

### Time-Off Requests

- `GET /time-off-requests`
  - Lists all requests.

- `POST /time-off-requests`
  - Creates a new time-off request.
  - Body:
    ```json
    {
      "employeeId": "emp-001",
      "locationId": "loc-nyc",
      "daysRequested": 2,
      "idempotencyKey": "optional-idempotency-key"
    }
    ```
  - Response:
    ```json
    {
      "id": "uuid",
      "employeeId": "emp-001",
      "locationId": "loc-nyc",
      "daysRequested": 2,
      "status": "pending",
      "idempotencyKey": "optional-idempotency-key",
      "approvalOperationId": null
    }
    ```

- `POST /time-off-requests/:id/approve`
  - Approves a request.
  - Body:
    ```json
    {
      "approvalOperationId": "optional-operation-id"
    }
    ```
  - Response:
    ```json
    {
      "id": "uuid",
      "status": "approved",
      "approvalOperationId": "operation-id"
    }
    ```

- `POST /time-off-requests/:id/reject`
  - Rejects a request.
  - Body:
    ```json
    {
      "reason": "Optional reason"
    }
    ```
  - Response:
    ```json
    {
      "id": "uuid",
      "status": "rejected"
    }
    ```

### HCM Integration

- `GET /hcm/events`
  - Lists integration events.

- `POST /hcm/sync`
  - Batch syncs balance data from HCM into local DB.
  - Requires header:
    - `x-service-token: <HCM_SYNC_SERVICE_TOKEN>`
  - Optional signature mode (if `HCM_SYNC_SIGNING_SECRET` is configured):
    - `x-timestamp: <unix-seconds>`
    - `x-signature: <hmac-sha256>`
  - Body:
    ```json
    {
      "balances": [
        {
          "employeeId": "emp-001",
          "locationId": "loc-nyc",
          "balance": 12.5,
          "lastSyncedAt": "2026-04-24T00:00:00.000Z"
        }
      ]
    }
    ```
  - Response:
    ```json
    {
      "received": 1,
      "processed": 1,
      "created": 1,
      "updated": 0,
      "skippedStale": 0
    }
    ```

## Security Notes

- `POST /api/hcm/sync` requires a service token (`x-service-token`).
- Optional request signing validates payload integrity:
  - Signature is HMAC-SHA256 of `${timestamp}.${jsonBody}`.
  - Timestamp TTL check helps mitigate replay attacks.
- Future improvement: add rate limiting/throttling on external-facing endpoints.

## Design Decisions

- **Why idempotency?**
  - Prevent duplicate resource creation and side effects during client retries.
- **Why retry only transient failures?**
  - 5xx/network/timeouts are likely temporary; 4xx business errors are deterministic and should fail fast.
- **Why timestamp-based sync?**
  - Prevent stale HCM payloads from overwriting newer local state, preserving data correctness in distributed flows.

---

If you are extending this service, start with `src/modules/time-off-request` and `src/modules/hcm-integration`, then add tests under `src/**/*.spec.ts` and `test/*.e2e-spec.ts`.
