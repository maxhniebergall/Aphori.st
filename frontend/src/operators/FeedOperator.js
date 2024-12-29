import axios from 'axios';
import { BaseOperator } from './BaseOperator';

class FeedOperator extends BaseOperator {
    async getFeedItems(page) {
        try {
            const data = await this.retryApiCall(
                () => axios.get(`${this.baseURL}/api/feed`, {
                    params: { page }
                })
            );

            // Parse the stringified JSON items
            if (data?.items) {
                const parsedItems = data.items.map(item => {
                    try {
                        return typeof item === 'string' ? JSON.parse(item) : item;
                    } catch (e) {
                        console.error('Error parsing feed item:', e);
                        return null;
                    }
                }).filter(Boolean); // Remove any null items from parsing errors

                return {
                    success: true,
                    data: {
                        ...data,
                        items: parsedItems
                    }
                };
            }

            return { success: true, data };
        } catch (error) {
            console.error('Error fetching feed items:', error);
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to fetch feed items'
            };
        }
    }
}

export const feedOperator = new FeedOperator();
export default feedOperator; 