import axios from 'axios';
import { BaseOperator } from './BaseOperator';
import compression from '../utils/compression';

class FeedOperator extends BaseOperator {
    async getFeedItems(page) {
        try {
            const response = await axios.get(`${this.baseURL}/api/feed`, {
                params: { page }
            });

            // Check if we got compressed data
            if (response.headers['x-data-compressed'] === 'true') {
                const decompressedData = await compression.decompress(response.data);
                return {
                    success: true,
                    data: {
                        page,
                        items: decompressedData.items.map(item => {
                            try {
                                return typeof item === 'string' ? JSON.parse(item) : item;
                            } catch (e) {
                                console.error('Error parsing feed item:', e);
                                return null;
                            }
                        }).filter(Boolean)
                    }
                };
            }

            // Handle uncompressed data
            if (response.data?.items) {
                return {
                    success: true,
                    data: {
                        ...response.data,
                        items: response.data.items.map(item => {
                            try {
                                return typeof item === 'string' ? JSON.parse(item) : item;
                            } catch (e) {
                                console.error('Error parsing feed item:', e);
                                return null;
                            }
                        }).filter(Boolean)
                    }
                };
            }

            return { success: true, data: response.data };
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