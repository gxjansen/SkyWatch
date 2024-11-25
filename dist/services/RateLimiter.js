"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlueSkyRateLimits = exports.RateLimiter = void 0;
class RateLimiter {
    constructor(config) {
        this.calls = [];
        this.backoffMs = 1000; // Start with 1 second backoff
        this.config = config;
    }
    /**
     * Update rate limiter state based on API response headers
     * @param headers Rate limit headers from API response
     */
    updateFromHeaders(headers) {
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
    isAllowed() {
        const now = Date.now();
        // If we have a reset time and haven't reached it yet, deny calls
        if (this.resetTime && now < this.resetTime) {
            return false;
        }
        // Remove calls outside the current time window
        this.calls = this.calls.filter(callTime => now - callTime < this.config.periodMs);
        // Check if we've reached the maximum number of calls
        // Use 90% of the limit to leave some buffer
        if (this.calls.length >= Math.floor(this.config.maxCalls * 0.9)) {
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
    getWaitTime() {
        const now = Date.now();
        if (this.resetTime && now < this.resetTime) {
            // If we have a reset time, wait until then plus some buffer
            return this.resetTime - now + 1000;
        }
        // If we have too many recent calls, wait based on the oldest call
        if (this.calls.length >= Math.floor(this.config.maxCalls * 0.9)) {
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
    async waitForNextSlot() {
        while (!this.isAllowed()) {
            const waitTime = this.getWaitTime();
            console.log(`[RateLimiter] Waiting ${Math.round(waitTime / 1000)}s before next attempt...`);
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
    reset() {
        this.calls = [];
        this.backoffMs = 1000;
        this.resetTime = undefined;
    }
}
exports.RateLimiter = RateLimiter;
// BlueSky-specific rate limit configuration
exports.BlueSkyRateLimits = {
    // Authentication rate limit (100 requests per day)
    AUTH: new RateLimiter({
        maxCalls: 100,
        periodMs: 24 * 60 * 60 * 1000 // 24 hours
    }),
    // API rate limits (50 requests per 5 minutes)
    FOLLOWS: new RateLimiter({
        maxCalls: 50,
        periodMs: 5 * 60 * 1000 // 5 minutes
    }),
    UNFOLLOW: new RateLimiter({
        maxCalls: 50, // Use full limit since it's a separate endpoint
        periodMs: 5 * 60 * 1000 // 5 minutes
    }),
    // General API rate limit for other endpoints
    GENERAL: new RateLimiter({
        maxCalls: 50,
        periodMs: 5 * 60 * 1000 // 5 minutes
    })
};
//# sourceMappingURL=RateLimiter.js.map