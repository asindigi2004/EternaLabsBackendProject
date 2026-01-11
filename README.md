# Order Execution Engine

[![CI](https://github.com/asindigi2004/EternaLabsBackendProject/actions/workflows/ci.yml/badge.svg)](https://github.com/asindigi2004/EternaLabsBackendProject/actions)
[![Deploy Status](https://img.shields.io/badge/deploy-unknown-lightgrey.svg)](REPLACE_WITH_DEPLOY_URL)

This repository implements an asynchronous order execution engine with realtime lifecycle streaming over WebSockets, background processing via BullMQ, and persistent state in PostgreSQL. The design is configuration-driven and avoids hardcoded behavior where possible.


## Table of contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Key components](#key-components)
- [Configuration](#configuration)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Design notes & rationale](#design-notes--rationale)
- [Next steps & recommendations](#next-steps--recommendations)


## Overview

The system provides an HTTP API to create orders, persists them to PostgreSQL, enqueues orders for background processing with BullMQ, processes orders through a lifecycle (pending → routing → building → submitted → confirmed/failed), and streams status updates to WebSocket clients in real time using a shared `EventEmitter`.

All configuration lives in `src/config/app.ts` and is used by every component (DEX price ranges, queue settings, order delays, success rate, Redis/Postgres connection settings).

## Architecture

- Client → `Fastify` HTTP API (`src/server.ts`, `src/routes/orders.ts`) for creating and querying orders.
- Order persistence via `OrderModel` (`src/models/orderModel.ts`) using the `pool` Postgres client.
- Queueing via `BullMQ` (`src/queues/orderQueue.ts`) and background processing with `orderWorker` (`src/queues/orderWorker.ts`).
- Business logic in `OrderService` (`src/services/orderService.ts`) which emits status updates through a centralized `orderEvents` emitter (`src/events/orderEvents.ts`).
- DEX quote simulation in `DexRouter` (`src/services/dexRouter.ts`) driven by `config` DEX settings.
- WebSocket realtime streaming handler in `src/websocket/index.ts` which replays historical statuses and subscribes to per-order event listeners.

## Key components

- `src/server.ts` — builds the Fastify server, registers routes and the WebSocket handler, and exposes `/health`.
- `src/routes/orders.ts` — API endpoints:
  - `POST /api/orders/execute` — create order, add to queue, returns `{ orderId, message }`.
  - `GET /api/orders/:orderId` — fetch order or 404.
  - `GET /api/orders` — list orders with optional `status` and `limit`.
  - `GET /api/orders/queue/stats` — queue statistics.
- `src/models/orderModel.ts` — DB mapping: `create`, `findById`, `update`, `findAll` and `mapRowToOrder`.
- `src/services/orderService.ts` — core logic:
  - `createOrder(input)` inserts order, caches in Redis, emits `pending` immediately.
  - `processOrder(orderId)` runs the lifecycle and emits `routing`, `building` (with `selectedDex` and `price`), `submitted`, then `confirmed` or `failed` based on `config.order.successRate`.
  - `updateOrderStatus` updates DB, cache, and emits updates with `orderEvents.emitStatusUpdate()`.
- `src/events/orderEvents.ts` — a small wrapper around `EventEmitter`:
  - `emitStatusUpdate(orderId, update)` builds a full `OrderStatusUpdate` object with `orderId` and `timestamp`, and emits both `order:<orderId>:status` (per-order) and `order:status` (global) channels.
  - `onOrderStatus(orderId, callback)` helper subscribes to `order:<orderId>:status` and returns an unsubscribe function.
- `src/queues/orderQueue.ts` — queue creation and `addOrderToQueue(orderId)`.
- `src/queues/orderWorker.ts` — worker that calls `OrderService.processOrder` for each job and logs lifecycle events.
- `src/websocket/index.ts` — WebSocket handler that:
  - Replays order statuses from DB on connect (via `sendInitialOrderStatus`).
  - Subscribes the socket to per-order updates using `orderEvents.onOrderStatus` and avoids duplicate messages using a `sentStatuses` set.

## Configuration

All runtime values are defined in `src/config/app.ts` under `config`:
- Server port/host
- Database connection settings
- Redis settings
- Queue config: name, concurrency, attempts/backoff, removeOnComplete/removeOnFail
- DEX list and their min/max price ranges (`config.dex.dexes`)
- Order processing delays and `successRate` (probability of confirmation)
- WebSocket channel prefixes and Redis cache prefix

This centralization avoids magic numbers in code. There is a small local constant in `sendInitialOrderStatus` (`delayBetweenStatuses = 50ms`) used only for replay pacing; consider moving that to `config.websocket` if you want full configurability.

## Running locally

Prereqs: Node >= 16, PostgreSQL, Redis (for queue/worker), and npm/yarn.

1. Install deps

```bash
npm install
```

2. Provide environment variables or use defaults defined in `src/config/app.ts` (DB/Redis connection, queue name, etc.).

3. Start the server (development)

```bash
npm run dev
# or
ts-node src/server.ts
```

4. To start the worker (process queue jobs)

```bash
node -r ts-node/register src/queues/orderWorker.ts
```

5. Endpoints

- POST `/api/orders/execute` — body: `{ tokenIn, tokenOut, amount }` → returns `{ orderId, message }`.
- GET `/api/orders/:orderId` — fetch order details.
- WebSocket: connect to `ws://<host>:<port>/api/orders/execute?orderId=<orderId>` (the handler expects `orderId` query param).

## Testing

- Unit & integration tests are in `tests/` and use Jest. The suite includes API route tests, service-level tests, and lifecycle streaming tests.
- Key testing patterns used:
  - Tests subscribe to per-order events via `orderEvents.onOrderStatus(orderId, handler)` and wait for final state using an event-driven helper instead of arbitrary `setTimeout` polling.
  - Lifecycle tests call `OrderService.processOrder(orderId)` directly in tests to avoid flaky queue timing (this keeps tests deterministic). For end-to-end queue integration, separate integration tests can start a real Redis and the `orderWorker`.
  - Deterministic failure paths are forced by temporarily mocking `Math.random()` in the test to force a failed final state so assertions can verify `errorReason` and final structure.

Run tests

```bash
npm test
```

Notes:
- If you want to run the full queue + worker end-to-end tests, make sure Redis is available and remove mocks for `orderQueue`/`orderWorker` in the test suite.

## Design notes & rationale

- Event model: The `orderEvents` emitter exposes both a per-order channel `order:<orderId>:status` (via `onOrderStatus`) and a global channel `order:status`. The WebSocket implementation uses per-order subscription to avoid filtering and duplicate work.
- Replaying state: `sendInitialOrderStatus` reads DB state and reconstructs a minimal lifecycle replay for clients that connect late. It uses `updatedAt` as an approximation for timestamps; if you need exact per-status timestamps, persist status history.
- Testing approach: Directly invoking `OrderService.processOrder` in tests provides deterministic lifecycle verification. This keeps unit/integration tests fast and reliable without spinning up Redis for unit suites.

## Next steps & recommendations

- Make `sendInitialOrderStatus` replay delay configurable via `config.websocket`.
- Add a persistent `order_status_history` table if you require exact historical timestamps and a full audit trail per order.
- Add CI integration tests that spin up Redis (Docker) and run a minimal end-to-end queue+worker smoke test.
- Add stricter schema validation for incoming API payloads (e.g., using JSON schema in Fastify route options).

## Troubleshooting

- If lifecycle tests time out: ensure `jest.setTimeout` is large enough and that the test environment is not mocking out `OrderModel` or `OrderService` in a way that prevents emits.
- If WebSocket clients don't receive events: confirm the worker calls `OrderService.processOrder` (either from the worker or invoked in test) and that `orderEvents.emitStatusUpdate` is being called; check Redis/DB connectivity for errors affecting processing.


If you'd like, I can:
- Run the Jest suite here and fix any failing tests.
- Add a Docker Compose file to spin up Postgres + Redis for local integration tests.
- Add a small script to run a single end-to-end order and print emitted statuses (handy for demos).

## Deployment

- Deployed URL: <REPLACE_WITH_PUBLIC_URL>

To publish this repository and get a public URL, connect this repository to a hosting provider (Render, Vercel, Railway, etc.) or push the repo to GitHub and link it from the provider. I'll add the final public URL here once the deployment succeeds.

### Docker

This project includes a `Dockerfile` for production deployments. Build and run locally:

```bash
docker build -t order-exec-engine .
docker run -p 3000:3000 --env-file .env order-exec-engine
```

### Continuous Integration

A GitHub Actions workflow is included at `.github/workflows/ci.yml` to run tests and build on push/PR. Once the repo is pushed to GitHub, the workflow will run automatically.
Feel free to ask which next step you want me to take.
 The Postman collection is included at: `postman_collection.json`.
# Order Execution Engine

This repository implements an asynchronous order execution pipeline with realtime WebSocket streaming, background processing via BullMQ, persistent PostgreSQL storage, and Redis caching. The README below explains the architecture, components, configuration, testing strategy, and developer notes.

**Contents**
- Architecture Overview
- Components & Key Files
- End-to-end event flow
- Configuration
- Running the app (dev / tests)
- Testing notes
- Developer recommendations and next steps

---

## Architecture Overview

The system is designed to accept order create requests via an HTTP API, persist an order row in PostgreSQL, enqueue work to BullMQ, process the order in a background worker, and stream every lifecycle update to connected WebSocket clients in real-time.

Primary goals:
- Decouple processing (worker) from client streaming (WebSocket) using a shared EventEmitter.
- Keep configuration centralized and avoid hardcoding values.
- Provide deterministic, testable lifecycle behavior for unit/integration tests.

---

## Components & Key Files

- `src/server.ts` — Fastify server bootstrap; registers routes and websocket plugin.
- `src/routes/orders.ts` — HTTP API routes:
  - `POST /api/orders/execute` — create + queue order
  - `GET /api/orders/:orderId` — fetch order
  - `GET /api/orders` — list orders
  - `GET /api/orders/queue/stats` — queue statistics
- `src/websocket/index.ts` — WebSocket handler and connection manager. Replays historical statuses from DB and subscribes to real-time updates.
- `src/events/orderEvents.ts` — Shared EventEmitter wrapper. Provides:
  - `emitStatusUpdate(orderId, update)` — emits per-order and global events
  - `onOrderStatus(orderId, callback)` — subscribe to per-order updates (returns unsubscribe)
- `src/models/orderModel.ts` — PostgreSQL access via `pool` with methods: `create`, `findById`, `update`, `findAll`.
- `src/services/dexRouter.ts` — Mock DEX quotes using `config.dex` (no hardcoded price ranges).
- `src/services/orderService.ts` — Core lifecycle logic and status emission:
  - `createOrder(input)` — creates DB row, caches to Redis, emits `pending`.
  - `updateOrderStatus(...)` — update DB, cache, and emit updates.
  - `processOrder(orderId)` — full lifecycle orchestration: `routing` → `building` → `submitted` → `confirmed`/`failed`.
- `src/queues/orderQueue.ts` — BullMQ queue wrapper and `addOrderToQueue(orderId)`.
- `src/queues/orderWorker.ts` — BullMQ `Worker` that calls `OrderService.processOrder`.
- `src/config/app.ts` — Central configuration for server, DB, Redis, queue, DEX, order delays, and success rate.

---

## End-to-End Event Flow

1. Client POSTs `POST /api/orders/execute` with `{ tokenIn, tokenOut, amount }`.
2. `OrderService.createOrder`:
   - inserts an order row in Postgres (status=`pending`),
   - caches a small record in Redis,
   - emits a `pending` status via `orderEvents.emitStatusUpdate(orderId, {...})`.
3. `addOrderToQueue(orderId)` enqueues a BullMQ job.
4. `orderWorker` processes the job and calls `OrderService.processOrder(orderId)`:
   - emits `routing`, `building` (with `selectedDex` + `price`), `submitted`, and final `confirmed` or `failed`.
   - final outcome uses `config.order.successRate` (randomized by `Math.random`).
5. `orderEvents` emits both a per-order channel (`order:<id>:status`) and a global channel (`order:status`).
6. WebSocket clients connect with `?orderId=<id>` and receive:
   - a replay of statuses from DB (via `sendInitialOrderStatus`), then
   - real-time updates via `orderEvents.onOrderStatus(orderId, callback)`.

---

## Configuration

All runtime values are provided from `src/config/app.ts`. Examples:
- DEX list and price ranges: `config.dex.dexes`
- Order processing delays: `config.order.processingDelays`
- Final success rate: `config.order.successRate` (0.0 - 1.0)
- Queue settings: `config.queue` (concurrency, attempts, backoff)
- Redis / DB connection settings

Avoid changing values directly in code. Prefer environment variables to override config.

---

## Running the application (development)

Preconditions:
- Node.js and npm installed.
- PostgreSQL running and reachable by config values.
- Redis running for BullMQ if you want queue/worker coverage.

Install deps and run tests:

```bash
npm install
npm test
```

Run server (development):

```bash
# Start server (Fastify) only
npm run start:dev
```

Run worker separately (if you have Redis):

```bash
# Start worker process (if configured)
node ./dist/src/queues/orderWorker.js
# Or use your npm script for worker if present
```

