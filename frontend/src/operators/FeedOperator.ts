import axios, { AxiosResponse } from 'axios';
// Removed: import { BaseOperator } from './BaseOperator';
import { FeedItemsResponse } from '../types/types';

/**
 * Requirements:
 * - Handle API response data (decompression now handled by browser).
 * - Support pagination with cursor-based navigation.
 * - Return feed items in a format compatible with the Feed component.
 * - Properly handle errors and edge cases.
 *
 * Enhancements:
 * - Added rate limiting to getFeedItems calls.
 */
class FeedOperator {
    private baseURL: string;
    // Rate limiting properties (one call per 1000ms)
    private lastFeedCallTime = 0;
    private readonly rateLimitInterval: number = 1000; // in milliseconds

    constructor(baseURL: string = process.env.REACT_APP_API_URL || 'http://localhost:5050') {
        this.baseURL = baseURL;
    }

    // Simple sleep helper
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getFeedItems(cursor: string): Promise<{ success: boolean; data?: FeedItemsResponse['data']; pagination?: FeedItemsResponse['pagination']; error?: string; }> {
        const now = Date.now();
        const timeElapsed = now - this.lastFeedCallTime;
        if (timeElapsed < this.rateLimitInterval) {
            const waitTime = this.rateLimitInterval - timeElapsed;
            await this.sleep(waitTime);
        }
        this.lastFeedCallTime = Date.now();

        try {
            const response: AxiosResponse<FeedItemsResponse> = await axios.get(`${this.baseURL}/api/feed`, {
                params: { cursor },
                validateStatus: status => status === 200
            });

            const responseData = response.data; // Already decompressed by browser

            if (responseData?.data && Array.isArray(responseData.data) && responseData.pagination) {
                return {
                    success: true,
                    data: responseData.data,
                    pagination: responseData.pagination
                };
            }

            console.error("Invalid feed data structure:", responseData);
            return {
                success: false,
                error: "Invalid feed data structure"
            };
        } catch (error: unknown) {
            console.error('Error fetching feed items:', error);
            const errorMessage = error instanceof Error 
                ? error.message 
                : 'Failed to fetch feed items';
            // Type assertion for AxiosError to access response property safely
            const axiosError = error as { response?: { data?: { error?: string } } };
            return {
                success: false,
                error: axiosError.response?.data?.error || errorMessage
            };
        }
    }
}

export const feedOperator = new FeedOperator();