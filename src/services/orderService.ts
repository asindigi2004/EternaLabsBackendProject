import { v4 as uuidv4 } from 'uuid';
import { OrderModel, Order, OrderStatus, CreateOrderInput } from '../models/orderModel';
import { DexRouter, DexQuote } from './dexRouter';
import { redisClient } from '../config/redis';
import { config } from '../config/app';
import { orderEvents } from '../events/orderEvents';

/**
 * Order Service
 * Handles order business logic and state transitions
 */
export class OrderService {
  /**
   * Create a new order
   * Immediately emits 'pending' status update for WebSocket clients
   */
  static async createOrder(input: CreateOrderInput): Promise<Order> {
    const orderId = uuidv4();
    const order = await OrderModel.create(input, orderId);

    // Store order ID in Redis for WebSocket tracking (using configured TTL)
    const cacheKey = `${config.websocket.orderCachePrefix}:${orderId}`;
    await redisClient.setex(cacheKey, config.order.cacheTtl, JSON.stringify({
      status: order.status,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
    }));

    // Emit 'pending' status immediately for WebSocket clients
    orderEvents.emitStatusUpdate(orderId, {
      status: 'pending',
      selectedDex: undefined,
      price: undefined,
    });

    return order;
  }

  /**
   * Get order by ID
   */
  static async getOrder(orderId: string): Promise<Order | null> {
    return OrderModel.findById(orderId);
  }

  /**
   * Update order status and emit event for WebSocket clients
   * This method updates the database and emits a status update event
   */
  static async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    additionalData?: {
      selectedDex?: string;
      price?: number;
      errorReason?: string;
    }
  ): Promise<Order | null> {
    const updateData: any = { status };

    if (additionalData?.selectedDex !== undefined) {
      updateData.selectedDex = additionalData.selectedDex;
    }

    if (additionalData?.price !== undefined) {
      updateData.price = additionalData.price;
    }

    if (additionalData?.errorReason) {
      updateData.errorReason = additionalData.errorReason;
    }

    const order = await OrderModel.update(orderId, updateData);

    if (order) {
      // Update Redis cache (using configured TTL and prefix)
      const cacheKey = `${config.websocket.orderCachePrefix}:${orderId}`;
      await redisClient.setex(cacheKey, config.order.cacheTtl, JSON.stringify({
        status: order.status,
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        selectedDex: order.selectedDex,
        price: order.price,
      }));

      // Emit status update event for WebSocket clients via event emitter
      // Use values from additionalData if provided, otherwise use values from database order
      // Always include orderId, status, selectedDex, price, and timestamp
      // This ensures ALL status changes are broadcast in real-time
      console.log(`[Order Service] Emitting status update for order ${orderId}: ${order.status}`);
      orderEvents.emitStatusUpdate(orderId, {
        status: order.status,
        selectedDex: additionalData?.selectedDex !== undefined 
          ? (additionalData.selectedDex ?? undefined)
          : (order.selectedDex ?? undefined),
        price: additionalData?.price !== undefined
          ? (additionalData.price ?? undefined)
          : (order.price ?? undefined),
        errorReason: additionalData?.errorReason || order.errorReason || undefined,
      });
    }

    return order;
  }

  /**
   * Process order through its full lifecycle
   * This is called by the BullMQ worker
   * 
   * Lifecycle stages (EACH emits a WebSocket update in sequence):
   * 1. pending - Already sent when order is created (via createOrder)
   * 2. routing - Finding best DEX (emitted here)
   * 3. building - Preparing transaction (emitted here)
   * 4. submitted - Sending to DEX (emitted here)
   * 5. confirmed OR failed - Final status (emitted here)
   */
  static async processOrder(orderId: string): Promise<void> {
    try {
      // Get order from database
      const order = await OrderModel.findById(orderId);
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      console.log(`[Order Service] Starting processing for order ${orderId} - emitting all status updates in sequence`);

      // Step 1: Routing - Find best DEX (using configured delays)
      // EMIT: routing status (selectedDex and price are undefined at this stage)
      console.log(`[Order Service] Order ${orderId}: Emitting 'routing' status`);
      const routingOrder = await OrderModel.update(orderId, { status: 'routing' });
      if (routingOrder) {
        // Update Redis cache
        const cacheKey = `${config.websocket.orderCachePrefix}:${orderId}`;
        await redisClient.setex(cacheKey, config.order.cacheTtl, JSON.stringify({
          status: routingOrder.status,
          tokenIn: routingOrder.tokenIn,
          tokenOut: routingOrder.tokenOut,
          selectedDex: null,
          price: null,
        }));
        // Emit routing status update with undefined for selectedDex and price
        orderEvents.emitStatusUpdate(orderId, {
          status: 'routing',
          selectedDex: undefined,
          price: undefined,
        });
      }
      const routingDelays = config.order.processingDelays;
      await this.simulateWork(routingDelays.routingMin, routingDelays.routingMax);

      // Find the best DEX route
      const bestRoute = await DexRouter.findBestRoute(
        order.tokenIn,
        order.tokenOut,
        order.amount
      );

      // Step 2: Building - Prepare transaction (using configured delays)
      // EMIT: building status (with selectedDex and price from best route)
      console.log(`[Order Service] Order ${orderId}: Emitting 'building' status with DEX ${bestRoute.dex} and price ${bestRoute.price}`);
      await this.updateOrderStatus(orderId, 'building', {
        selectedDex: bestRoute.dex,
        price: bestRoute.price,
      });
      await this.simulateWork(routingDelays.buildingMin, routingDelays.buildingMax);

      // Step 3: Submitted - Send to DEX (using configured delays)
      // EMIT: submitted status (with selectedDex and price)
      console.log(`[Order Service] Order ${orderId}: Emitting 'submitted' status`);
      await this.updateOrderStatus(orderId, 'submitted', {
        selectedDex: bestRoute.dex,
        price: bestRoute.price,
      });
      await this.simulateWork(routingDelays.submittedMin, routingDelays.submittedMax);

      // Step 4: Confirm or fail (using configured success rate)
      // EMIT: confirmed OR failed status (final status with selectedDex, price, and errorReason if failed)
      const success = Math.random() > (1 - config.order.successRate);

      if (success) {
        console.log(`[Order Service] Order ${orderId}: Emitting 'confirmed' status (final)`);
        await this.updateOrderStatus(orderId, 'confirmed', {
          selectedDex: bestRoute.dex,
          price: bestRoute.price,
        });
        console.log(`[Order Service] Order ${orderId} confirmed successfully`);
      } else {
        console.log(`[Order Service] Order ${orderId}: Emitting 'failed' status (final)`);
        await this.updateOrderStatus(orderId, 'failed', {
          selectedDex: bestRoute.dex,
          price: bestRoute.price,
          errorReason: 'Simulated DEX execution failure',
        });
        console.log(`[Order Service] Order ${orderId} failed`);
      }
    } catch (error) {
      console.error(`[Order Service] Error processing order ${orderId}:`, error);
      // EMIT: failed status on error (preserve selectedDex and price if available)
      const currentOrder = await OrderModel.findById(orderId);
      console.log(`[Order Service] Order ${orderId}: Emitting 'failed' status due to error`);
      await this.updateOrderStatus(orderId, 'failed', {
        selectedDex: currentOrder?.selectedDex,
        price: currentOrder?.price,
        errorReason: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Simulate work with random delay
   */
  private static async simulateWork(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
