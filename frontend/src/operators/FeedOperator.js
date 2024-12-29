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