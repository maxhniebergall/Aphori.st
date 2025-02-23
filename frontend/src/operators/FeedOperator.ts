import axios from 'axios';
import { BaseOperator } from './BaseOperator';
import { FeedItem, FeedItemsResponse } from '../types/types';
import compression from '../utils/compression';
import { Compressed } from '../types/compressed';

/**
 * Requirements:
 * - Handle compressed response data from backend
 * - Support pagination with cursor-based navigation
 * - Return feed items in a format compatible with the Feed component
 * - Properly handle errors and edge cases
 *
 * Enhancements:
 * - Added rate limiting to getFeedItems calls
 */
class FeedOperator extends BaseOperator {
    // Rate limiting properties (one call per 1000ms)
    private lastFeedCallTime: number = 0;
    private readonly rateLimitInterval: number = 1000; // in milliseconds

    // Simple sleep helper
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getFeedItems(cursor: string) {
        // Rate limiting: wait if the last call was too recent
        const now = Date.now();
        const timeElapsed = now - this.lastFeedCallTime;
        if (timeElapsed < this.rateLimitInterval) {
            const waitTime = this.rateLimitInterval - timeElapsed;
            await this.sleep(waitTime);
        }
        this.lastFeedCallTime = Date.now();

        try {
            const compressedFeedItems = await this.retryApiCallSimplified<Compressed<FeedItemsResponse>>(
                () => axios.get(`${this.baseURL}/api/feed`, {
                    params: { cursor },
                    validateStatus: status => status === 200
                })
            );

            if (!compressedFeedItems) {
                throw new Error('No feed items received');
            }
            
            console.log("FeedOperator: Decompressing feed items:", compressedFeedItems);
            const decompressedFeedItems = await compression.decompress<Compressed<FeedItemsResponse>, FeedItemsResponse>(compressedFeedItems);

            // If response is already decompressed by BaseOperator
            if (decompressedFeedItems?.feedItems && Array.isArray(decompressedFeedItems.feedItems) && decompressedFeedItems.pagination) {
                return {
                    success: true,
                    items: decompressedFeedItems.feedItems,
                    pagination: decompressedFeedItems.pagination
                };
            }

            console.error("Invalid feed data structure:", decompressedFeedItems);
            return {
                success: false,
                error: "Invalid feed data structure"
            };
        } catch (error: any) {
            console.error('Error fetching feed items:', error);
            return {
                success: false,
                error: error.response?.data?.error || error.message || 'Failed to fetch feed items'
            };
        }
    }
}

export const feedOperator = new FeedOperator();
export default feedOperator; 