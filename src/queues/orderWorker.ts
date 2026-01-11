import { Worker, Job } from 'bullmq';
import { redisConfig } from '../config/redis';
import { OrderService } from '../services/orderService';
import { config } from '../config/app';

/**
 * Order Worker
 * Processes orders from the queue
 * All configuration loaded from centralized config system
 */
// Export a possibly-null worker so tests can avoid starting it
export let orderWorker: Worker | null = null;

// Only auto-start the worker when not in a test environment
if (process.env.NODE_ENV !== 'test') {
  orderWorker = new Worker(
    config.queue.name,
    async (job: Job<{ orderId: string }>) => {
      const { orderId } = job.data;
      console.log(`[Order Worker] Processing order ${orderId} (Job ID: ${job.id})`);

      try {
        await OrderService.processOrder(orderId);
        console.log(`[Order Worker] Successfully processed order ${orderId}`);
        return { success: true, orderId };
      } catch (error) {
        console.error(`[Order Worker] Error processing order ${orderId}:`, error);
        throw error; // Re-throw to trigger retry mechanism
      }
    },
    {
      connection: redisConfig,
      concurrency: config.queue.concurrency,
      limiter: {
        max: config.queue.limiterMax,
        duration: config.queue.limiterDuration,
      },
    }
  );

  // Worker event handlers
  orderWorker.on('completed', (job) => {
    console.log(`[Order Worker] Job ${job.id} completed`);
  });

  orderWorker.on('failed', (job, err) => {
    console.error(`[Order Worker] Job ${job?.id} failed:`, err);
  });

  orderWorker.on('error', (err) => {
    console.error('[Order Worker] Worker error:', err);
  });
}

/**
 * Gracefully close the worker
 */
export async function closeWorker(): Promise<void> {
  if (orderWorker) {
    await orderWorker.close();
    console.log('Order worker closed');
  }
}
