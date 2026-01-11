import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import { initializeDatabase, testConnection } from './config/db';
import { testRedisConnection } from './config/redis';
import { registerOrderRoutes } from './routes/orders';
import { registerWebSocket } from './websocket';
import { orderWorker } from './queues/orderWorker';

// Load environment variables
dotenv.config();

/**
 * Main server application
 */
async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        process.env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
  });

  // Register WebSocket support
  await fastify.register(websocket);

  // Register routes
  await fastify.register(registerOrderRoutes);

  // Register WebSocket handler
  await fastify.register(registerWebSocket);

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    const dbStatus = await testConnection();
    const redisStatus = await testRedisConnection();

    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus ? 'connected' : 'disconnected',
        redis: redisStatus ? 'connected' : 'disconnected',
      },
    });
  });

  return fastify;
}

/**
 * Start the server
 */
async function start() {
  try {
    // Initialize database
    console.log('Initializing database...');
    try {
      await initializeDatabase();
      await testConnection();
    } catch (error) {
      console.error('\n❌ Database connection failed!');
      console.error('Please ensure PostgreSQL is running and accessible.');
      console.error('Connection details:', {
        host: (await import('./config/app')).config.database.host,
        port: (await import('./config/app')).config.database.port,
        database: (await import('./config/app')).config.database.name,
      });
      console.error('\nTo start PostgreSQL:');
      console.error('  - Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres');
      console.error('  - Windows: Start PostgreSQL service from Services');
      console.error('  - macOS: brew services start postgresql');
      console.error('  - Linux: sudo systemctl start postgresql\n');
      throw error;
    }

    // Test Redis connection
    console.log('Testing Redis connection...');
    try {
      await testRedisConnection();
    } catch (error) {
      console.error('\n❌ Redis connection failed!');
      console.error('Please ensure Redis is running and accessible.');
      console.error('Connection details:', {
        host: (await import('./config/app')).config.redis.host,
        port: (await import('./config/app')).config.redis.port,
      });
      console.error('\nTo start Redis:');
      console.error('  - Docker: docker run -d -p 6379:6379 redis');
      console.error('  - Windows: Download and run Redis from redis.io');
      console.error('  - macOS: brew services start redis');
      console.error('  - Linux: sudo systemctl start redis\n');
      throw error;
    }

    // Build and start Fastify server
    const fastify = await buildServer();
    const { config } = await import('./config/app');

    await fastify.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });

    console.log(`🚀 Server listening on http://${config.server.host}:${config.server.port}`);
    console.log(`📊 Health check: http://${config.server.host}:${config.server.port}/health`);
    console.log(`📝 API endpoint: http://${config.server.host}:${config.server.port}/api/orders/execute`);
    console.log(`🔌 WebSocket endpoint: ws://${config.server.host}:${config.server.port}/api/orders/execute?orderId=<orderId>`);
    console.log(`⚙️  Order worker started with concurrency: ${config.queue.concurrency}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);

      // Close Fastify server
      await fastify.close();

      // Close worker (may be null in test environment)
      if (orderWorker) {
        await orderWorker.close();
      }

      // Close Redis connections
      const { closeRedisConnections } = await import('./config/redis');
      await closeRedisConnections();

      // Close database pool
      const { pool } = await import('./config/db');
      await pool.end();

      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  start();
}

export { buildServer, start };
