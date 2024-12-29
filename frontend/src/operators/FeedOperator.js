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
            console.log("data", data);
            try {
                if (data.items) {
                    return { success: true, items: data.items.map((item) => JSON.parse(item)) };
                }
            } catch (e) {
                console.error("Error parsing data", e);
                return { success: false, error: "Error parsing data" };
            }
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