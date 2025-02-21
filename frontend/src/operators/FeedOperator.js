import axios from 'axios';
import { BaseOperator } from './BaseOperator';

/**
 * Requirements:
 * - Handle compressed response data from backend
 * - Support pagination with cursor-based navigation
 * - Return feed items in a format compatible with the Feed component
 * - Properly handle errors and edge cases
 */
class FeedOperator extends BaseOperator {
    async getFeedItems(cursor) {
        try {
            const response = await this.retryApiCall(
                () => axios.get(`${this.baseURL}/api/feed`, {
                    params: { cursor },
                    validateStatus: status => status === 200
                })
            );

            // If response is already decompressed by BaseOperator
            if (response?.data && Array.isArray(response.data)) {
                return {
                    success: true,
                    items: response.data,
                    pagination: response.pagination || {
                        hasMore: false,
                        matchingItemsCount: response.data.length
                    }
                };
            }

            // Handle the case where data is nested under 'data' property
            if (response?.data?.data && Array.isArray(response.data.data)) {
                return {
                    success: true,
                    items: response.data.data,
                    pagination: response.data.pagination || {
                        hasMore: false,
                        matchingItemsCount: response.data.data.length
                    }
                };
            }

            console.error("Invalid feed data structure:", response);
            return {
                success: false,
                error: "Invalid feed data structure"
            };
        } catch (error) {
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