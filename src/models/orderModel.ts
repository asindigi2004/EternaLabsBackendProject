import { pool } from '../config/db';

/**
 * Order status types
 */
export type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

/**
 * Order entity interface
 */
export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  selectedDex?: string;
  price?: number;
  status: OrderStatus;
  errorReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Order creation input
 */
export interface CreateOrderInput {
  tokenIn: string;
  tokenOut: string;
  amount: number;
}

/**
 * Order update input
 */
export interface UpdateOrderInput {
  status?: OrderStatus;
  selectedDex?: string;
  price?: number;
  errorReason?: string;
}

/**
 * Order Model - Database operations for orders
 */
export class OrderModel {
  /**
   * Create a new order in the database
   */
  static async create(input: CreateOrderInput, orderId: string): Promise<Order> {
    const query = `
      INSERT INTO orders (id, token_in, token_out, amount, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [orderId, input.tokenIn, input.tokenOut, input.amount, 'pending'];
    const result = await pool.query(query, values);
    return this.mapRowToOrder(result.rows[0]);
  }

  /**
   * Find an order by ID
   */
  static async findById(id: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToOrder(result.rows[0]);
  }

  /**
   * Update an order
   */
  static async update(id: string, input: UpdateOrderInput): Promise<Order | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(input.status);
    }

    if (input.selectedDex !== undefined) {
      updates.push(`selected_dex = $${paramCount++}`);
      values.push(input.selectedDex);
    }

    if (input.price !== undefined) {
      updates.push(`price = $${paramCount++}`);
      values.push(input.price);
    }

    if (input.errorReason !== undefined) {
      updates.push(`error_reason = $${paramCount++}`);
      values.push(input.errorReason);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE orders
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToOrder(result.rows[0]);
  }

  /**
   * Get all orders with optional status filter
   */
  static async findAll(status?: OrderStatus, limit: number = 100): Promise<Order[]> {
    let query = 'SELECT * FROM orders';
    const values: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      values.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
    values.push(limit);

    const result = await pool.query(query, values);
    return result.rows.map((row) => this.mapRowToOrder(row));
  }

  /**
   * Map database row to Order entity
   */
  private static mapRowToOrder(row: any): Order {
    return {
      id: row.id,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amount: parseFloat(row.amount),
      selectedDex: row.selected_dex || undefined,
      price: row.price ? parseFloat(row.price) : undefined,
      status: row.status as OrderStatus,
      errorReason: row.error_reason || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
