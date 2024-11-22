import { IFollower } from '../models/Follower';

declare global {
    namespace Express {
        interface Request {
            // Add any custom request properties here
        }
    }
}

// Define types for EJS template data
declare module 'express-serve-static-core' {
    interface AggregateStats {
        minFollowers?: number;
        maxFollowers?: number;
        minFollowing?: number;
        maxFollowing?: number;
        minPosts?: number;
        maxPosts?: number;
        minPostsPerDay?: number;
        maxPostsPerDay?: number;
        minFollowerRatio?: number;
        maxFollowerRatio?: number;
        minJoined?: Date;
        maxJoined?: Date;
        minLastPost?: Date;
        maxLastPost?: Date;
    }

    interface FilterValues {
        minFollowers?: string;
        maxFollowers?: string;
        minFollowing?: string;
        maxFollowing?: string;
        minPosts?: string;
        maxPosts?: string;
        minPostsPerDay?: string;
        maxPostsPerDay?: string;
        minFollowerRatio?: string;
        maxFollowerRatio?: string;
        minJoined?: string;
        maxJoined?: string;
        minLastPost?: string;
        maxLastPost?: string;
    }

    interface MainUser {
        handle: string;
        avatar: string;
        followerCount: number;
        followingCount: number;
        postCount: number;
        postsPerDay: number;
        followerRatio: number;
        joinedAt: string;
        lastPostAt: string | null;
    }

    interface Response {
        render(view: string, locals: {
            followers: IFollower[];
            currentPage: number;
            totalPages: number;
            totalFollowers: number;
            isImporting: boolean;
            title: string;
            subtitle: string;
            userHandle: string;
            stats: AggregateStats;
            filters: FilterValues;
            mainUser: MainUser;
        }): void;
    }
}

export {};
