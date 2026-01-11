/**
 * Helper script to create .env file
 * Run: node create-env.js
 */

const fs = require('fs');
const path = require('path');

const envContent = `# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database Configuration
# Update DB_PASSWORD with your PostgreSQL container password
# If you used: docker run -e POSTGRES_PASSWORD=password, then use "password"
DB_HOST=localhost
DB_PORT=5432
DB_NAME=order_engine
DB_USER=postgres
DB_PASSWORD=password
DB_MAX_CONNECTIONS=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=2000

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_MAX_RETRIES=3

# Queue Configuration (BullMQ)
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

# DEX Configuration
DEX_NAMES=Raydium,Meteora
DEX_RAYDIUM_MIN_PRICE=0.98
DEX_RAYDIUM_MAX_PRICE=1.02
DEX_METEORA_MIN_PRICE=0.97
DEX_METEORA_MAX_PRICE=1.05
DEX_QUOTE_FETCH_DELAY_MIN_MS=100
DEX_QUOTE_FETCH_DELAY_MAX_MS=300

# Order Processing Configuration
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

# WebSocket Configuration
WS_ORDER_STATUS_CHANNEL_PREFIX=order
WS_ORDER_CACHE_PREFIX=order
`;

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log('⚠️  .env file already exists. Backing up to .env.backup');
  fs.copyFileSync(envPath, path.join(__dirname, '.env.backup'));
}

fs.writeFileSync(envPath, envContent);
console.log('✅ .env file created successfully!');
console.log('\n📝 IMPORTANT: Update DB_PASSWORD in .env with your PostgreSQL container password');
console.log('   To check your PostgreSQL password, run:');
console.log('   docker inspect postgres-order- | findstr POSTGRES_PASSWORD');
console.log('\n   Or if you created it with: docker run -e POSTGRES_PASSWORD=yourpassword');
console.log('   Then update DB_PASSWORD=yourpassword in .env');
console.log('\n   Default is usually "password" if you used the QUICKSTART.md instructions');
