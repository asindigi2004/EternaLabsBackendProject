import { FastifyInstance } from 'fastify';
import { OrderModel } from '../models/orderModel';
import { orderEvents, OrderStatusUpdate } from '../events/orderEvents';

/**
 * WebSocket Connection Manager
 * Maintains a map of active WebSocket connections per orderId
 * Each orderId can have multiple WebSocket connections (multiple clients)
 */
class WebSocketConnectionManager {
  /**
   * Map of orderId -> Set of WebSocket connections
   * Allows multiple clients to subscribe to the same order
   */
  private connections = new Map<string, Set<any>>();

  /**
   * Add a WebSocket connection for an order
   */
  addConnection(orderId: string, connection: any): void {
    if (!this.connections.has(orderId)) {
      this.connections.set(orderId, new Set());
    }
    this.connections.get(orderId)!.add(connection);
  }

  /**
   * Remove a WebSocket connection for an order
   */
  removeConnection(orderId: string, connection: any): void {
    const connections = this.connections.get(orderId);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.connections.delete(orderId);
      }
    }
  }

  /**
   * Get all connections for an order
   */
  getConnections(orderId: string): Set<any> | undefined {
    return this.connections.get(orderId);
  }

  /**
   * Check if there are any connections for an order
   */
  hasConnections(orderId: string): boolean {
    return this.connections.has(orderId) && this.connections.get(orderId)!.size > 0;
  }

  /**
   * Broadcast a status update to all connections for an order
   */
  broadcast(orderId: string, update: OrderStatusUpdate): void {
    const connections = this.connections.get(orderId);
    if (connections && connections.size > 0) {
      const message = JSON.stringify(update);
      connections.forEach((connection) => {
        try {
          if (connection.socket.readyState === 1) { // WebSocket.OPEN
            connection.socket.send(message);
          }
        } catch (error) {
          console.error(`[WebSocket] Error sending update to connection:`, error);
          // Remove broken connection
          this.removeConnection(orderId, connection);
        }
      });
    }
  }
}

// Singleton instance
const connectionManager = new WebSocketConnectionManager();

/**
 * Initialize WebSocket handler for order status streaming
 * Streams full lifecycle updates: pending → routing → building → submitted → confirmed/failed
 */
export async function registerWebSocket(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/orders/execute', { websocket: true }, async (connection, req) => {
    const orderId = (req.query as any).orderId;

    if (!orderId) {
      connection.socket.close(1008, 'Missing orderId query parameter');
      return;
    }

    console.log(`[WebSocket] Client connected for order ${orderId}`);

    // Add connection to manager for broadcasting
    connectionManager.addConnection(orderId, connection);

    // Track which statuses we've already sent to avoid duplicates
    const sentStatuses = new Set<string>();

    // Helper to send status update and track it
    const sendStatusUpdate = (update: OrderStatusUpdate) => {
      if (sentStatuses.has(update.status)) {
        console.log(`[WebSocket] Skipping duplicate status ${update.status} for order ${orderId}`);
        return;
      }
      
      if (connection.socket.readyState === 1) { // WebSocket.OPEN
        sentStatuses.add(update.status);
        console.log(`[WebSocket] Sending status update to client for order ${orderId}: ${update.status}`, {
          selectedDex: update.selectedDex,
          price: update.price,
          timestamp: update.timestamp,
        });
        connection.socket.send(JSON.stringify(update));
      } else {
        console.warn(`[WebSocket] Cannot send status update for order ${orderId}: WebSocket not open (readyState: ${connection.socket.readyState})`);
      }
    };

    // Send initial order status from database (replays all historical statuses)
    // This runs first to ensure we get all statuses, even if processing already started
    await sendInitialOrderStatus(connection, orderId, sentStatuses);

    // Subscribe to global status updates and filter by orderId
    const statusHandler = (update: OrderStatusUpdate) => {
      try {
        if (update.orderId !== orderId) return;
        if (!sentStatuses.has(update.status)) {
          sendStatusUpdate(update);
        } else {
          console.log(`[WebSocket] Ignoring duplicate real-time status ${update.status} for order ${orderId} (already sent in replay)`);
        }
      } catch (error) {
        console.error(`[WebSocket] Error sending status update for order ${orderId}:`, error);
      }
    };

    orderEvents.on('status', statusHandler);

    // Handle connection close
    connection.socket.on('close', () => {
      console.log(`[WebSocket] Client disconnected for order ${orderId}`);
      orderEvents.off('status', statusHandler);
      connectionManager.removeConnection(orderId, connection);
    });

    // Handle errors
    connection.socket.on('error', (error: Error) => {
      console.error(`[WebSocket] Error for order ${orderId}:`, error);
      orderEvents.off('status', statusHandler);
      connectionManager.removeConnection(orderId, connection);
    });
  });
}

/**
 * Send all status updates in sequence to a WebSocket connection
 * Replays the full lifecycle: pending → routing → building → submitted → confirmed/failed
 * This ensures clients see ALL statuses, even if they connect after processing completes
 */
async function sendInitialOrderStatus(connection: any, orderId: string, sentStatuses: Set<string>): Promise<void> {
  try {
    // Prefer in-memory buffer for replaying recent updates
    const buffered = orderEvents.getBuffered(orderId);
    if (buffered && buffered.length > 0) {
      console.log(`[WebSocket] Replaying ${buffered.length} buffered updates for order ${orderId}`);
      const sendInline = (update: OrderStatusUpdate) => {
        if (!sentStatuses.has(update.status) && connection.socket.readyState === 1) {
          sentStatuses.add(update.status);
          connection.socket.send(JSON.stringify(update));
        }
      };

      for (const update of buffered) {
        sendInline(update);
      }
      return;
    }

    // Fallback to DB if no buffer present
    const order = await OrderModel.findById(orderId);
    if (!order) {
      connection.socket.send(
        JSON.stringify({
          orderId,
          status: 'not_found' as any,
          selectedDex: undefined,
          price: undefined,
          error: 'Order not found',
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    console.log(`[WebSocket] Replaying DB-derived status for order ${orderId} (current status: ${order.status})`);

    // send pending
    if (!sentStatuses.has('pending') && connection.socket.readyState === 1) {
      sentStatuses.add('pending');
      connection.socket.send(JSON.stringify({
        orderId: order.id,
        status: 'pending',
        selectedDex: undefined,
        price: undefined,
        timestamp: order.createdAt.toISOString(),
      }));
    }

    // send a few subsequent statuses up to current state
    const laterStatuses: OrderStatusUpdate[] = [];
    if (order.status !== 'pending') {
      laterStatuses.push({ orderId: order.id, status: 'routing', timestamp: order.updatedAt.toISOString() } as any);
    }
    if (['building', 'submitted', 'confirmed', 'failed'].includes(order.status)) {
      laterStatuses.push({ orderId: order.id, status: 'building', selectedDex: order.selectedDex ?? undefined, price: order.price ?? undefined, timestamp: order.updatedAt.toISOString() } as any);
    }
    if (['submitted', 'confirmed', 'failed'].includes(order.status)) {
      laterStatuses.push({ orderId: order.id, status: 'submitted', selectedDex: order.selectedDex ?? undefined, price: order.price ?? undefined, timestamp: order.updatedAt.toISOString() } as any);
    }
    if (order.status === 'confirmed' || order.status === 'failed') {
      laterStatuses.push({ orderId: order.id, status: order.status, selectedDex: order.selectedDex ?? undefined, price: order.price ?? undefined, errorReason: order.errorReason, timestamp: order.updatedAt.toISOString() } as any);
    }

    for (const u of laterStatuses) {
      if (!sentStatuses.has(u.status) && connection.socket.readyState === 1) {
        sentStatuses.add(u.status);
        connection.socket.send(JSON.stringify(u));
      }
    }
  } catch (error) {
    console.error(`[WebSocket] Error fetching initial order status for ${orderId}:`, error);
    connection.socket.send(
      JSON.stringify({
        orderId,
        status: 'error' as any,
        selectedDex: undefined,
        price: undefined,
        error: 'Failed to fetch order status',
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Broadcast status update to all WebSocket connections for an order
 * This is called by the order service when status changes
 */
// Note: broadcasting to all connections is handled internally by the connection manager
