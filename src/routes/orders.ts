import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OrderService } from '../services/orderService';
import { addOrderToQueue, getQueueStats } from '../queues/orderQueue';
import { OrderModel } from '../models/orderModel';

/**
 * Request body interface for order execution
 */
interface ExecuteOrderBody {
  tokenIn: string;
  tokenOut: string;
  amount: number;
}

/**
 * Register order routes
 */
export async function registerOrderRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/orders/execute
   * Create a new order and add it to the processing queue
   */
  fastify.post<{ Body: ExecuteOrderBody }>(
    '/api/orders/execute',
    async (request: FastifyRequest<{ Body: ExecuteOrderBody }>, reply: FastifyReply) => {
      try {
        const { tokenIn, tokenOut, amount } = request.body;

        // Validate input
        if (!tokenIn || !tokenOut || !amount) {
          return reply.status(400).send({
            error: 'Missing required fields: tokenIn, tokenOut, amount',
          });
        }

        if (typeof amount !== 'number' || amount <= 0) {
          return reply.status(400).send({
            error: 'Amount must be a positive number',
          });
        }

        // Create order
        const order = await OrderService.createOrder({
          tokenIn,
          tokenOut,
          amount,
        });

        // Add order to processing queue
        await addOrderToQueue(order.id);

        // Return order ID immediately
        return reply.status(201).send({
          orderId: order.id,
          message: 'Order created and queued for processing',
        });
      } catch (error) {
        console.error('[Orders Route] Error creating order:', error);
        return reply.status(500).send({
          error: 'Failed to create order',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/orders/:orderId
   * Get order status by ID
   */
  fastify.get<{ Params: { orderId: string } }>(
    '/api/orders/:orderId',
    async (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
      try {
        const { orderId } = request.params;

        const order = await OrderService.getOrder(orderId);

        if (!order) {
          return reply.status(404).send({
            error: 'Order not found',
          });
        }

        return reply.send({
          id: order.id,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amount: order.amount,
          selectedDex: order.selectedDex,
          price: order.price,
          status: order.status,
          errorReason: order.errorReason,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        });
      } catch (error) {
        console.error('[Orders Route] Error fetching order:', error);
        return reply.status(500).send({
          error: 'Failed to fetch order',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/orders
   * Get all orders with optional status filter
   */
  fastify.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/orders',
    async (request: FastifyRequest<{ Querystring: { status?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const { config } = await import('../config/app');
        const status = request.query.status as any;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : config.order.defaultLimit;

        const orders = await OrderModel.findAll(status, limit);

        return reply.send({
          orders,
          count: orders.length,
        });
      } catch (error) {
        console.error('[Orders Route] Error fetching orders:', error);
        return reply.status(500).send({
          error: 'Failed to fetch orders',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/orders/queue/stats
   * Get queue statistics
   */
  fastify.get('/api/orders/queue/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getQueueStats();
      return reply.send(stats);
    } catch (error) {
      console.error('[Orders Route] Error fetching queue stats:', error);
      return reply.status(500).send({
        error: 'Failed to fetch queue statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
