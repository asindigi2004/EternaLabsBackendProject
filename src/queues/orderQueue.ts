import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis';
import { config } from '../config/app';

/**
 * Order Queue
 * BullMQ queue for processing orders asynchronously
 * All configuration loaded from centralized config system
 */
export const orderQueue = new Queue(config.queue.name, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: config.queue.maxAttempts,
    backoff: {
      type: config.queue.backoffType,
      delay: config.queue.backoffDelay,
    },
    removeOnComplete: {
      age: config.queue.removeOnCompleteAge,
      count: config.queue.removeOnCompleteCount,
    },
    removeOnFail: {
      age: config.queue.removeOnFailAge,
    },
  },
});

/**
 * Add an order to the processing queue
 * @param orderId - The order ID to process
 */
export async function addOrderToQueue(orderId: string): Promise<void> {
  await orderQueue.add('process-order', { orderId }, {
    jobId: orderId, // Use orderId as jobId to prevent duplicates
  });
  console.log(`[Order Queue] Added order ${orderId} to queue`);
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    orderQueue.getWaitingCount(),
    orderQueue.getActiveCount(),
    orderQueue.getCompletedCount(),
    orderQueue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
  };
}
