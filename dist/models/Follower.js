"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Follower = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const FollowerSchema = new mongoose_1.default.Schema({
    did: { type: String, required: true, unique: true },
    handle: { type: String, required: true },
    displayName: { type: String },
    avatar: { type: String },
    followedAt: { type: Date, required: true },
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postCount: { type: Number, default: 0 },
    joinedAt: { type: Date },
    lastPostAt: { type: Date },
    followerRatio: {
        type: Number,
        default: 0
    },
    postsPerDay: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});
// Method to calculate follower ratio
FollowerSchema.methods.calculateFollowerRatio = function () {
    // Ensure we have valid numbers before calculation
    const followers = typeof this.followerCount === 'number' ? this.followerCount : 0;
    const following = typeof this.followingCount === 'number' ? this.followingCount : 0;
    this.followerRatio = following > 0
        ? Number((followers / following).toFixed(2))
        : 0;
    return this.followerRatio;
};
// Method to calculate average posts per day
FollowerSchema.methods.calculatePostsPerDay = function () {
    if (!this.postCount) {
        this.postsPerDay = 0;
        return 0;
    }
    const today = new Date();
    let startDate;
    // If we have lastPostAt, use it as the end date instead of today
    const endDate = this.lastPostAt || today;
    // Use joinedAt as the start date if available, otherwise use a fallback date
    if (this.joinedAt) {
        startDate = this.joinedAt;
    }
    else {
        // If no joinedAt date is available, use a reasonable fallback (e.g., 30 days ago)
        startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
    }
    // Calculate days between dates, ensuring at least 1 day
    const daysSinceStart = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    this.postsPerDay = Number((this.postCount / daysSinceStart).toFixed(2));
    return this.postsPerDay;
};
// Pre-save hook to calculate ratios
FollowerSchema.pre('save', function (next) {
    if (this.isModified('followerCount') || this.isModified('followingCount')) {
        this.calculateFollowerRatio();
    }
    if (this.isModified('postCount') || this.isModified('joinedAt') || this.isModified('lastPostAt')) {
        this.calculatePostsPerDay();
    }
    next();
});
exports.Follower = mongoose_1.default.model('Follower', FollowerSchema);
//# sourceMappingURL=Follower.js.map