"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlueSkyRateLimits = exports.RateLimiter = void 0;
class RateLimiter {
    constructor(config) {
        this.calls = [];
        this.config = config;
    }
    /**
     * Check if a new call is allowed based on rate limit
     * @returns boolean indicating if the call is permitted
     */
    isAllowed() {
        const now = Date.now();
        // Remove calls outside the current time window
        this.calls = this.calls.filter(callTime => now - callTime < this.config.periodMs);
        // Check if we've reached the maximum number of calls
        if (this.calls.length >= Math.floor(this.config.maxCalls * 0.5)) {
            return false;
        }
        // Record this call
        this.calls.push(now);
        return true;
    }
    /**
     * Wait until next available call slot
     * @returns Promise that resolves when a call can be made
     */
    async waitForNextSlot() {
        while (!this.isAllowed()) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
exports.RateLimiter = RateLimiter;
// BlueSky-specific rate limit configuration
exports.BlueSkyRateLimits = {
    // BlueSky's documented limits: 50 requests per 5 minutes
    FOLLOWS: new RateLimiter({
        maxCalls: 50,
        periodMs: 5 * 60 * 1000 // 5 minutes
    }),
    UNFOLLOW: new RateLimiter({
        maxCalls: 25, // Conservative limit, half of total
        periodMs: 5 * 60 * 1000 // 5 minutes
    })
};
//# sourceMappingURL=RateLimiter.js.map