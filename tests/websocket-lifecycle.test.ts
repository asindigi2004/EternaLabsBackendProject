import { orderEvents } from '../src/events/orderEvents';
import { OrderService } from '../src/services/orderService';

// Increase timeout for lifecycle tests
jest.setTimeout(20000);

describe('WebSocket Lifecycle Streaming', () => {
  // Helper to collect statuses for a specific orderId until final state or timeout
  const waitForFinalStatus = (orderId: string, timeout = 15000) => {
    return new Promise<any[]>((resolve) => {
      const updates: any[] = [];
      // Read buffered updates first
      const buffered = orderEvents.getBuffered(orderId);
      if (buffered && buffered.length > 0) {
        updates.push(...buffered);
        if (buffered.some((u: any) => u.status === 'confirmed' || u.status === 'failed')) {
          resolve(updates);
          return;
        }
      }

      let unsubscribe: (() => void) | undefined;
      const handler = (update: any) => {
        updates.push(update);
        if (update.status === 'confirmed' || update.status === 'failed') {
          if (unsubscribe) unsubscribe();
          resolve(updates);
        }
      };

      unsubscribe = orderEvents.onOrderStatus(orderId, handler as any);

      setTimeout(() => {
        if (unsubscribe) unsubscribe();
        resolve(updates);
      }, timeout);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    const { closeRedisConnections } = await import('../src/config/redis');
    await closeRedisConnections();
    orderEvents.shutdown();
  });

  test('should emit pending status first and progress through lifecycle', async () => {
    const order = await OrderService.createOrder({ tokenIn: 'SOL', tokenOut: 'USDC', amount: 100 });

    const processing = OrderService.processOrder(order.id);
    const updates = await waitForFinalStatus(order.id);
    await processing.catch(() => undefined);

    const statuses = updates.map(u => u.status);
    expect(statuses[0]).toBe('pending');
    expect(statuses).toEqual(expect.arrayContaining(['pending', 'routing', 'building', 'submitted']));
    expect(statuses.some(s => s === 'confirmed' || s === 'failed')).toBe(true);
  });

  test('should include selectedDex and price in building and after', async () => {
    const order = await OrderService.createOrder({ tokenIn: 'SOL', tokenOut: 'USDC', amount: 100 });

    const processing = OrderService.processOrder(order.id);
    const updates = await waitForFinalStatus(order.id);
    await processing.catch(() => undefined);

    const building = updates.find(u => u.status === 'building');
    expect(building).toBeDefined();
    expect(building.selectedDex).toBeDefined();
    expect(typeof building.price).toBe('number');

    const final = updates[updates.length - 1];
    expect(final.selectedDex).toBeDefined();
    expect(typeof final.price).toBe('number');
  });

  test('should include timestamp in every status update', async () => {
    const order = await OrderService.createOrder({ tokenIn: 'SOL', tokenOut: 'USDC', amount: 100 });

    const processing = OrderService.processOrder(order.id);
    const updates = await waitForFinalStatus(order.id);
    await processing.catch(() => undefined);

    expect(updates.length).toBeGreaterThan(0);
    updates.forEach(u => {
      expect(typeof u.timestamp).toBe('string');
      expect(() => new Date(u.timestamp)).not.toThrow();
    });
  });

  test('should include errorReason on failed status when failure forced', async () => {
    const originalRandom = Math.random;
    try {
      // Force failure by returning 0.0 (success condition: Math.random() > (1 - successRate))
      Math.random = () => 0.0;

      const order = await OrderService.createOrder({ tokenIn: 'SOL', tokenOut: 'USDC', amount: 100 });

      const processing = OrderService.processOrder(order.id);
      const updates = await waitForFinalStatus(order.id);
      await processing.catch(() => undefined);

      const failed = updates.find(u => u.status === 'failed');
      expect(failed).toBeDefined();
      expect(typeof failed.errorReason).toBe('string');
      expect(failed.errorReason.length).toBeGreaterThan(0);
    } finally {
      Math.random = originalRandom;
    }
  });
});
