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
    private lastFeedCallTime = 0;
    private readonly rateLimitInterval: number = 1000; // in milliseconds

    // Simple sleep helper
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetches feed items, handling rate limiting and API retries.
     * @param cursor The pagination cursor.
     * @returns An object containing feed items and pagination info, or an error state.
     * @throws {Error} If the API call returns no data after retries (internal throw).
     *                 (Handled: Caught locally, returns { success: false, error: ... }).
     * Note: Other errors from underlying API calls are caught and converted to the error state return.
     */
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
            const compressedFeedItems = await this.retryApiCallSimplified<FeedItemsResponse>(
                () => axios.get(`${this.baseURL}/api/feed`, {
                    params: { cursor },
                    validateStatus: status => status === 200
                })
            );
            // Decompress the feed items after fetching
            const decompressedFeedItems = compression.decompress<FeedItemsResponse>(compressedFeedItems);

            // If response is already decompressed by BaseOperator
            if (decompressedFeedItems?.data && Array.isArray(decompressedFeedItems.data) && decompressedFeedItems.pagination) {
                return {
                    success: true,
                    data: decompressedFeedItems.data,
                    pagination: decompressedFeedItems.pagination
                };
            }

            console.error("Invalid feed data structure:", decompressedFeedItems);
            return {
                success: false,
                error: "Invalid feed data structure"
            };
        } catch (error: unknown) {
            console.error('Error fetching feed items:', error);
            const errorMessage = error instanceof Error 
                ? error.message 
                : 'Failed to fetch feed items';
            const responseError = error as { response?: { data?: { error?: string } } };
            return {
                success: false,
                error: responseError.response?.data?.error || errorMessage
            };
        }
    }
}

export const feedOperator = new FeedOperator();