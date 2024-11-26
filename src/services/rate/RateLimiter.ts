// Time periods in milliseconds
const TIME_PERIODS = {
  FIVE_MINUTES: 5 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 1000
};

// BlueSky's rate limits
const BLUESKY_LIMITS = {
  FIVE_MIN: 5000,   // 5,000 requests per 5 minutes
  HOURLY: 50000     // 50,000 requests per hour
};

// Rate limit configuration
const RATE_LIMITS = {
  // Authentication rate limit (conservative for login attempts)
  AUTH: {
    maxCalls: Math.floor(100),  // Max: No specific limit documented
    periodMs: TIME_PERIODS.ONE_DAY                      // Period: 24 hours
  },
  
  // API rate limits for follows/profile operations
  FOLLOWS: {
    maxCalls: Math.floor(BLUESKY_LIMITS.FIVE_MIN),
    periodMs: TIME_PERIODS.FIVE_MINUTES
  },
  
  // API rate limits for unfollow operations
  UNFOLLOW: {
    maxCalls: Math.floor(BLUESKY_LIMITS.FIVE_MIN),
    periodMs: TIME_PERIODS.FIVE_MINUTES
  },
  
  // General API rate limit for other endpoints
  GENERAL: {
    maxCalls: Math.floor(BLUESKY_LIMITS.FIVE_MIN),
    periodMs: TIME_PERIODS.FIVE_MINUTES
  }
};

interface RateLimitConfig {
  maxCalls: number;
  periodMs: number;
}

interface RateLimitHeaders {
  'ratelimit-limit'?: string;
  'ratelimit-remaining'?: string;
  'ratelimit-reset'?: string;
  'ratelimit-policy'?: string;
}

export class RateLimiter {
  private calls: number[] = [];
  private config: RateLimitConfig;
  private backoffMs: number = 1000; // Start with 1 second backoff
  private resetTime?: number;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Update rate limiter state based on API response headers
   * @param headers Rate limit headers from API response
   */
  updateFromHeaders(headers: RateLimitHeaders): void {
    if (headers['ratelimit-reset']) {
      // Convert reset time to milliseconds and add buffer
      this.resetTime = parseInt(headers['ratelimit-reset']) * 1000 + 1000;
    }
    
    if (headers['ratelimit-remaining'] === '0') {
      // Clear calls array to force waiting
      this.calls = [];
      // Increase backoff if we hit the limit
      this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    }
  }

  /**
   * Check if a new call is allowed based on rate limit
   * @returns boolean indicating if the call is permitted
   */
  isAllowed(): boolean {
    const now = Date.now();
    
    // If we have a reset time and haven't reached it yet, deny calls
    if (this.resetTime && now < this.resetTime) {
      return false;
    }

    // Remove calls outside the current time window
    this.calls = this.calls.filter(
      callTime => now - callTime < this.config.periodMs
    );

    // Check if we've reached the maximum number of calls
    if (this.calls.length >= this.config.maxCalls) {
      return false;
    }

    // Record this call
    this.calls.push(now);
    return true;
  }

  /**
   * Calculate wait time based on current state
   * @returns milliseconds to wait
   */
  private getWaitTime(): number {
    const now = Date.now();

    if (this.resetTime && now < this.resetTime) {
      // If we have a reset time, wait until then plus some buffer
      return this.resetTime - now + 1000;
    }

    // If we have too many recent calls, wait based on the oldest call
    if (this.calls.length >= this.config.maxCalls) {
      const oldestCall = Math.min(...this.calls);
      const waitTime = (oldestCall + this.config.periodMs) - now;
      return Math.max(waitTime, this.backoffMs);
    }

    return this.backoffMs;
  }

  /**
   * Wait until next available call slot with exponential backoff
   * @returns Promise that resolves when a call can be made
   */
  async waitForNextSlot(): Promise<void> {
    while (!this.isAllowed()) {
      const waitTime = this.getWaitTime();
      console.log(`[RateLimiter] Waiting ${Math.round(waitTime/1000)}s before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // Exponential backoff up to 30 seconds if we're still hitting limits
      this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    }
    // Reset backoff on successful call
    this.backoffMs = 1000;
  }

  /**
   * Reset the rate limiter state
   */
  reset(): void {
    this.calls = [];
    this.backoffMs = 1000;
    this.resetTime = undefined;
  }
}

// BlueSky-specific rate limit configuration
export const BlueSkyRateLimits = {
  AUTH: new RateLimiter(RATE_LIMITS.AUTH),
  FOLLOWS: new RateLimiter(RATE_LIMITS.FOLLOWS),
  UNFOLLOW: new RateLimiter(RATE_LIMITS.UNFOLLOW),
  GENERAL: new RateLimiter(RATE_LIMITS.GENERAL)
};
