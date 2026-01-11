import { config } from '../config/app';

/**
 * DEX Router Service
 * Simulates routing to different DEXes and selecting the best price
 * All configuration is loaded from centralized config system
 */

export type DexName = string;

export interface DexQuote {
  dex: DexName;
  price: number;
}

/**
 * Mock DEX Router Service
 * Simulates price quotes from different DEXes and selects the best one
 * Uses configuration from app config instead of hardcoded values
 */
export class DexRouter {
  /**
   * Get a mock price quote for a specific DEX
   * Uses configured min/max price ranges from app config
   */
  private static getDexPrice(dexConfig: { name: string; minPrice: number; maxPrice: number }): number {
    const { minPrice, maxPrice } = dexConfig;
    return Math.random() * (maxPrice - minPrice) + minPrice;
  }

  /**
   * Get quotes from all available DEXes
   * Uses configured DEX list and price ranges from app config
   * @param tokenIn - Input token symbol
   * @param tokenOut - Output token symbol
   * @param amount - Amount to swap
   * @returns Array of quotes from all configured DEXes
   */
  static async getQuotes(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote[]> {
    // Simulate network delay for fetching quotes (from config)
    const { min, max } = config.dex.quoteFetchDelay;
    await this.simulateDelay(min, max);

    // Generate quotes for all configured DEXes
    const quotes: DexQuote[] = config.dex.dexes.map((dexConfig) => ({
      dex: dexConfig.name,
      price: this.getDexPrice(dexConfig),
    }));

    return quotes;
  }

  /**
   * Find the best DEX quote (highest price wins)
   * @param tokenIn - Input token symbol
   * @param tokenOut - Output token symbol
   * @param amount - Amount to swap
   * @returns Best quote with selected DEX
   */
  static async findBestRoute(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    const quotes = await this.getQuotes(tokenIn, tokenOut, amount);

    // Select the quote with the highest price
    const bestQuote = quotes.reduce((best, current) => {
      return current.price > best.price ? current : best;
    });

    console.log(`[DEX Router] Quotes received:`, quotes);
    console.log(`[DEX Router] Selected DEX: ${bestQuote.dex} with price: ${bestQuote.price.toFixed(4)}`);

    return bestQuote;
  }

  /**
   * Simulate network delay
   * Uses configured delay ranges
   */
  private static async simulateDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
