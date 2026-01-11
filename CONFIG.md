# Configuration Guide

All configuration values can be set via environment variables. No hardcoded values remain in the codebase.

## Environment Variables

### Server Configuration

```env
# Server port (default: 3000)
PORT=3000

# Server host (default: 0.0.0.0)
HOST=0.0.0.0

# Node environment (default: development)
NODE_ENV=development
```

### Database Configuration

```env
# PostgreSQL host (default: localhost)
DB_HOST=localhost

# PostgreSQL port (default: 5432)
DB_PORT=5432

# Database name (default: order_engine)
DB_NAME=order_engine

# Database user (default: user)
DB_USER=postgres

# Database password (default: password)
DB_PASSWORD=password

# Maximum database connections (default: 20)
DB_MAX_CONNECTIONS=20

# Idle timeout in milliseconds (default: 30000)
DB_IDLE_TIMEOUT_MS=30000

# Connection timeout in milliseconds (default: 2000)
DB_CONNECTION_TIMEOUT_MS=2000
```

### Redis Configuration

```env
# Redis host (default: localhost)
REDIS_HOST=localhost

# Redis port (default: 6379)
REDIS_PORT=6379

# Redis password (optional)
REDIS_PASSWORD=

# Maximum retries per request (default: 3)
REDIS_MAX_RETRIES=3
```

### Queue Configuration (BullMQ)

```env
# Queue name (default: orders)
QUEUE_NAME=orders

# Worker concurrency - number of orders processed simultaneously (default: 10)
QUEUE_CONCURRENCY=10

# Maximum retry attempts (default: 3)
QUEUE_MAX_ATTEMPTS=3

# Backoff delay in milliseconds (default: 2000)
QUEUE_BACKOFF_DELAY_MS=2000

# Backoff type: 'exponential' or 'fixed' (default: exponential)
QUEUE_BACKOFF_TYPE=exponential

# Rate limiter: maximum jobs (default: 100)
QUEUE_LIMITER_MAX=100

# Rate limiter: duration in milliseconds (default: 1000)
QUEUE_LIMITER_DURATION_MS=1000

# Keep completed jobs for this many seconds (default: 3600)
QUEUE_REMOVE_ON_COMPLETE_AGE_SEC=3600

# Maximum number of completed jobs to keep (default: 1000)
QUEUE_REMOVE_ON_COMPLETE_COUNT=1000

# Keep failed jobs for this many seconds (default: 86400)
QUEUE_REMOVE_ON_FAIL_AGE_SEC=86400
```

### DEX Configuration

```env
# Comma-separated list of DEX names (default: Raydium,Meteora)
DEX_NAMES=Raydium,Meteora

# Raydium price range
DEX_RAYDIUM_MIN_PRICE=0.98
DEX_RAYDIUM_MAX_PRICE=1.02

# Meteora price range
DEX_METEORA_MIN_PRICE=0.97
DEX_METEORA_MAX_PRICE=1.05

# Quote fetch delay range in milliseconds
DEX_QUOTE_FETCH_DELAY_MIN_MS=100
DEX_QUOTE_FETCH_DELAY_MAX_MS=300
```

### Order Processing Configuration

```env
# Processing delays in milliseconds
ORDER_ROUTING_DELAY_MIN_MS=500
ORDER_ROUTING_DELAY_MAX_MS=1000

ORDER_BUILDING_DELAY_MIN_MS=1000
ORDER_BUILDING_DELAY_MAX_MS=2000

ORDER_SUBMITTED_DELAY_MIN_MS=500
ORDER_SUBMITTED_DELAY_MAX_MS=1500

ORDER_QUOTE_FETCH_DELAY_MIN_MS=100
ORDER_QUOTE_FETCH_DELAY_MAX_MS=300

# Success rate (0.0 to 1.0, default: 0.9 = 90%)
ORDER_SUCCESS_RATE=0.9

# Redis cache TTL in seconds (default: 3600)
ORDER_CACHE_TTL_SEC=3600

# Default limit for order queries (default: 100)
ORDER_DEFAULT_LIMIT=100
```

### WebSocket Configuration

```env
# Redis channel prefix for order status updates (default: order)
WS_ORDER_STATUS_CHANNEL_PREFIX=order

# Redis cache key prefix for orders (default: order)
WS_ORDER_CACHE_PREFIX=order
```

## Example .env File

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=order_engine
DB_USER=postgres
DB_PASSWORD=your_password
DB_MAX_CONNECTIONS=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=2000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_MAX_RETRIES=3

# Queue
QUEUE_NAME=orders
QUEUE_CONCURRENCY=10
QUEUE_MAX_ATTEMPTS=3
QUEUE_BACKOFF_DELAY_MS=2000
QUEUE_BACKOFF_TYPE=exponential
QUEUE_LIMITER_MAX=100
QUEUE_LIMITER_DURATION_MS=1000
QUEUE_REMOVE_ON_COMPLETE_AGE_SEC=3600
QUEUE_REMOVE_ON_COMPLETE_COUNT=1000
QUEUE_REMOVE_ON_FAIL_AGE_SEC=86400

# DEX
DEX_NAMES=Raydium,Meteora
DEX_RAYDIUM_MIN_PRICE=0.98
DEX_RAYDIUM_MAX_PRICE=1.02
DEX_METEORA_MIN_PRICE=0.97
DEX_METEORA_MAX_PRICE=1.05
DEX_QUOTE_FETCH_DELAY_MIN_MS=100
DEX_QUOTE_FETCH_DELAY_MAX_MS=300

# Order Processing
ORDER_ROUTING_DELAY_MIN_MS=500
ORDER_ROUTING_DELAY_MAX_MS=1000
ORDER_BUILDING_DELAY_MIN_MS=1000
ORDER_BUILDING_DELAY_MAX_MS=2000
ORDER_SUBMITTED_DELAY_MIN_MS=500
ORDER_SUBMITTED_DELAY_MAX_MS=1500
ORDER_QUOTE_FETCH_DELAY_MIN_MS=100
ORDER_QUOTE_FETCH_DELAY_MAX_MS=300
ORDER_SUCCESS_RATE=0.9
ORDER_CACHE_TTL_SEC=3600
ORDER_DEFAULT_LIMIT=100

# WebSocket
WS_ORDER_STATUS_CHANNEL_PREFIX=order
WS_ORDER_CACHE_PREFIX=order
```

## Configuration Validation

The application validates configuration on startup. Invalid values will cause the application to fail with descriptive error messages:

- Success rate must be between 0 and 1
- DEX min price must be less than max price
- All prices must be positive
- Delay min values must be less than max values

## Adding New DEXes

To add a new DEX, simply add it to the `DEX_NAMES` environment variable and configure its price range:

```env
DEX_NAMES=Raydium,Meteora,Orca
DEX_ORCA_MIN_PRICE=0.99
DEX_ORCA_MAX_PRICE=1.03
```

The system will automatically discover and use the new DEX.
