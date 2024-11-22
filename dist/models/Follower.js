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
    followerRatio: {
        type: Number,
        default: 0 // Set a simple default value of 0
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
// Pre-save hook to calculate follower ratio
FollowerSchema.pre('save', function (next) {
    if (this.isModified('followerCount') || this.isModified('followingCount')) {
        this.calculateFollowerRatio();
    }
    next();
});
exports.Follower = mongoose_1.default.model('Follower', FollowerSchema);
//# sourceMappingURL=Follower.js.map