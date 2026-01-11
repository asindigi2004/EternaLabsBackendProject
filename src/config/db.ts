import { Pool, PoolConfig } from 'pg';
import { config } from './app';

// Note: dotenv is loaded in app.ts, no need to load here

/**
 * PostgreSQL database configuration and connection pool
 * Handles connection to PostgreSQL database for order storage
 * All configuration loaded from centralized config system
 */
const dbConfig: PoolConfig = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  // Connection pool settings (from config)
  max: config.database.maxConnections,
  idleTimeoutMillis: config.database.idleTimeoutMillis,
  connectionTimeoutMillis: config.database.connectionTimeoutMillis,
};

// Create a connection pool
export const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

/**
 * Initialize database schema
 * Creates the orders table if it doesn't exist
 */
export async function initializeDatabase(): Promise<void> {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        token_in TEXT NOT NULL,
        token_out TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        selected_dex TEXT,
        price NUMERIC,
        status TEXT NOT NULL,
        error_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    `;

    await pool.query(createTableQuery);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connection successful:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}
