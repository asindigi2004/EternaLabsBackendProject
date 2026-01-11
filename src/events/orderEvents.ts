import { EventEmitter } from 'events';
import { config } from '../config/app';

/**
 * Order Status Update Event Data
 * Contains all information about an order status change
 */
export interface OrderStatusUpdate {
  orderId: string;
  status: 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';
  selectedDex?: string;
  price?: number;
  errorReason?: string;
  timestamp: string;
}

/**
 * Order Event Emitter
 * Singleton event emitter for broadcasting order status updates
 * Used to decouple order processing from WebSocket connections
 */
class OrderEventEmitter extends EventEmitter {
  // In-memory buffer for recent status updates per order
  private buffer = new Map<string, { updates: OrderStatusUpdate[]; lastTouched: number }>();

  // Maximum number of updates to keep per order
  private maxPerOrder = 50;

  // Buffer TTL in milliseconds (configurable)
  private bufferTtlMs = (config.websocket as any).bufferTtlMs || 1000 * 60 * 60; // default 1 hour

  // Periodic cleanup handle
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Kick off periodic cleanup
    this.cleanupIntervalHandle = setInterval(() => this.cleanupBuffers(), Math.min(this.bufferTtlMs, 1000 * 60));
    // Allow Jest/tests to exit without being kept alive by this interval
    if (this.cleanupIntervalHandle && typeof (this.cleanupIntervalHandle as any).unref === 'function') {
      (this.cleanupIntervalHandle as any).unref();
    }
  }
  /**
   * Emit an order status update event
   * @param orderId - The order ID
   * @param update - The status update data
   */
  emitStatusUpdate(orderId: string, update: Omit<OrderStatusUpdate, 'orderId' | 'timestamp'>): void {
    const statusUpdate: OrderStatusUpdate = {
      orderId,
      status: update.status,
      selectedDex: update.selectedDex ?? undefined,
      price: update.price ?? undefined,
      errorReason: update.errorReason,
      timestamp: new Date().toISOString(),
    };

    // Buffer per-order
    const now = Date.now();
    const entry = this.buffer.get(orderId) || { updates: [], lastTouched: now };
    entry.updates.push(statusUpdate);
    entry.lastTouched = now;
    // Cap stored updates
    if (entry.updates.length > this.maxPerOrder) {
      entry.updates.splice(0, entry.updates.length - this.maxPerOrder);
    }
    this.buffer.set(orderId, entry);

    // Emit to both order-specific channel and global channel name 'status'
    this.emit(`order:${orderId}:status`, statusUpdate);
    this.emit('status', statusUpdate);

    console.log(`[Order Events] Status update for order ${orderId}: ${update.status}`, {
      selectedDex: statusUpdate.selectedDex,
      price: statusUpdate.price,
      timestamp: statusUpdate.timestamp,
    });
  }

  /**
   * Subscribe to status updates for a specific order
   * @param orderId - The order ID to listen for
   * @param callback - Callback function to handle updates
   * @returns Function to unsubscribe
   */
  onOrderStatus(
    orderId: string,
    callback: (update: OrderStatusUpdate) => void
  ): () => void {
    const eventName = `order:${orderId}:status`;
    this.on(eventName, callback);

    // Return unsubscribe function
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * Get buffered updates for an order (returns a shallow copy)
   */
  getBuffered(orderId: string): OrderStatusUpdate[] {
    const entry = this.buffer.get(orderId);
    return entry ? [...entry.updates] : [];
  }

  /**
   * Cleanup buffers older than TTL
   */
  private cleanupBuffers(): void {
    const now = Date.now();
    for (const [orderId, entry] of this.buffer.entries()) {
      if (now - entry.lastTouched > this.bufferTtlMs) {
        this.buffer.delete(orderId);
      }
    }
  }

  // Allow graceful shutdown of cleanup interval
  shutdown(): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }
  }
}

/**
 * Singleton instance of Order Event Emitter
 * This is the shared event bus for order status updates
 */
export const orderEvents = new OrderEventEmitter();

// Set max listeners to handle many concurrent orders
orderEvents.setMaxListeners(1000);
