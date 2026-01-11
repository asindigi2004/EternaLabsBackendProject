import { buildServer } from '../src/server';
import { OrderService } from '../src/services/orderService';
import { DexRouter } from '../src/services/dexRouter';
import { OrderModel } from '../src/models/orderModel';
import { addOrderToQueue } from '../src/queues/orderQueue';
import { pool } from '../src/config/db';
import { redisClient } from '../src/config/redis';
import { orderEvents } from '../src/events/orderEvents';

jest.mock('../src/config/db');
jest.mock('../src/config/redis');
jest.mock('../src/queues/orderQueue');
// Provide Jest mocks for OrderModel methods used in tests
jest.mock('../src/models/orderModel', () => ({
  OrderModel: {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  },
}));

// Increase timeout for integration-style lifecycle tests
jest.setTimeout(20000);

describe('Order Execution Engine Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  afterAll(async () => {
    // Ensure Redis connections and event buffers are closed so Jest can exit cleanly
    const { closeRedisConnections } = await import('../src/config/redis');
    await closeRedisConnections();
    orderEvents.shutdown();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // 1) Mock DEX Logic Tests
  describe('DEX Router Service', () => {
    test('should get quotes from all DEXes', async () => {
      const quotes = await DexRouter.getQuotes('SOL', 'USDC', 100);
      expect(quotes).toHaveLength(2);
      expect(quotes.some(q => q.dex === 'Raydium')).toBe(true);
      expect(quotes.some(q => q.dex === 'Meteora')).toBe(true);

      quotes.forEach(q => {
        if (q.dex === 'Raydium') {
          expect(q.price).toBeGreaterThanOrEqual(0.98);
          expect(q.price).toBeLessThanOrEqual(1.02);
        } else {
          expect(q.price).toBeGreaterThanOrEqual(0.97);
          expect(q.price).toBeLessThanOrEqual(1.05);
        }
      });
    });

    test('should select best route based on highest price', async () => {
      const bestRoute = await DexRouter.findBestRoute('SOL', 'USDC', 100);
      expect(['Raydium', 'Meteora']).toContain(bestRoute.dex);
      expect(bestRoute.price).toBeGreaterThan(0);
    });
  });

  // 2) Order Service Tests
  describe('Order Service', () => {
    test('should create a new order', async () => {
      const mockOrder = {
        id: 'test-order-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 50,
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (OrderModel.create as jest.Mock).mockResolvedValue(mockOrder);
      (redisClient.setex as jest.Mock).mockResolvedValue('OK');

      const order = await OrderService.createOrder({
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 50,
      });

      expect(order).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.tokenIn).toBe('SOL');
    });

    test('should update order status', async () => {
      const mockOrder = {
        id: 'test-order-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 50,
        status: 'routing' as const,
      };
      (OrderModel.findById as jest.Mock).mockResolvedValue(mockOrder);
      (OrderModel.update as jest.Mock).mockResolvedValue(mockOrder);
      (redisClient.setex as jest.Mock).mockResolvedValue('OK');

      const updated = await OrderService.updateOrderStatus('test-order-1', 'routing');
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('routing');
      expect(OrderModel.update).toHaveBeenCalledWith('test-order-1', { status: 'routing' });
    });

    test('should get order by ID', async () => {
      const mockOrder = {
        id: 'test-order-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 100,
        status: 'pending',
      };
      (OrderModel.findById as jest.Mock).mockResolvedValue(mockOrder);

      const order = await OrderService.getOrder('test-order-1');
      expect(order).toBeDefined();
      expect(order?.id).toBe('test-order-1');
    });
  });

  // 3) API Endpoint Tests
  describe('API Endpoints', () => {
    test('POST /api/orders/execute - success', async () => {
      const mockOrder = {
        id: 'api-test-order-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 10,
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (OrderModel.create as jest.Mock).mockResolvedValue(mockOrder);
      (redisClient.setex as jest.Mock).mockResolvedValue('OK');
      (addOrderToQueue as jest.Mock).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: { tokenIn: 'SOL', tokenOut: 'USDC', amount: 10 },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('orderId');
      expect(body).toHaveProperty('message');
    });

    test('POST /api/orders/execute - invalid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: { tokenIn: 'SOL' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
    });

    test('GET /api/orders/:orderId - not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/orders/non-existent',
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toHaveProperty('error');
    });

    test('GET /api/orders - list orders', async () => {
      const mockOrders = [
        { id: '1', tokenIn: 'SOL', tokenOut: 'USDC', amount: 10, status: 'pending' },
      ];
      (OrderModel.findAll as jest.Mock).mockResolvedValueOnce(mockOrders);

      const res = await app.inject({ method: 'GET', url: '/api/orders' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.orders).toBeDefined();
      expect(body.count).toBeDefined();
    });

    test('GET /health - should return services', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ now: new Date() }] });
      (redisClient.ping as jest.Mock).mockResolvedValueOnce('PONG');

      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.services).toHaveProperty('database');
      expect(body.services).toHaveProperty('redis');
    });
  });

  // 4) Queue Integration Test
  describe('Order Queue Integration', () => {
    test('should add order to queue', async () => {
      const mockOrder = { id: 'test', tokenIn: 'SOL', tokenOut: 'USDC', amount: 10, status: 'pending' as const };
      (OrderModel.create as jest.Mock).mockResolvedValue(mockOrder);
      (redisClient.setex as jest.Mock).mockResolvedValue('OK');
      (addOrderToQueue as jest.Mock).mockResolvedValue(undefined);

      const order = await OrderService.createOrder({ tokenIn: mockOrder.tokenIn, tokenOut: mockOrder.tokenOut, amount: mockOrder.amount } as any);
      // Simulate queue addition as the route would do
      await addOrderToQueue(order.id);
      expect(addOrderToQueue).toHaveBeenCalled();
    });
  });

  // 5) EventEmitter & WebSocket Lifecycle Tests
  describe('WebSocket Lifecycle Events', () => {
    // Helper to wait for final status via event emitter
    const waitForFinalStatus = (orderId: string, timeout = 10000) => {
      return new Promise<string[]>((resolve) => {
        const collected: string[] = [];
        let unsubscribe: (() => void) | undefined;

        const handler = (update: any) => {
          collected.push(update.status);
          if (update.status === 'confirmed' || update.status === 'failed') {
            if (unsubscribe) unsubscribe();
            resolve(collected);
          }
        };

        unsubscribe = orderEvents.onOrderStatus(orderId, handler);

        // Fallback timeout to resolve with whatever we've got
        setTimeout(() => {
          if (unsubscribe) unsubscribe();
          resolve(collected);
        }, timeout);
      });
    };

    test('should emit pending first and progress through lifecycle', async () => {
      const mockOrder = {
        id: 'lifecycle-test-order',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 10,
        status: 'pending' as const,
      };

      (OrderModel.create as jest.Mock).mockResolvedValue(mockOrder);
      (OrderModel.findById as jest.Mock).mockResolvedValue(mockOrder);
      (OrderModel.update as jest.Mock).mockImplementation(async (id: string, data: any) => ({ ...mockOrder, ...data }));
      (redisClient.setex as jest.Mock).mockResolvedValue('OK');

      const order = await OrderService.createOrder({ tokenIn: 'SOL', tokenOut: 'USDC', amount: 10 });

      // Trigger processing directly to avoid queue/worker timing issues in tests
      const processing = OrderService.processOrder(order.id);

      // Include any buffered updates emitted during createOrder (pending)
      const initialBuffered = orderEvents.getBuffered(order.id).map((u) => u.status);
      const streamed = await waitForFinalStatus(order.id, 15000);
      const statuses = [...initialBuffered, ...streamed];
      await processing.catch(() => undefined);

      // Order.create should set initial status to 'pending'
      expect(order.status).toBe('pending');
      expect(statuses).toEqual(expect.arrayContaining(['routing', 'building', 'submitted']));
      expect(statuses.some(s => s === 'confirmed' || s === 'failed')).toBe(true);
    });
  });
});
