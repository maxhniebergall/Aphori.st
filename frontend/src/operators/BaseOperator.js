import compression from '../utils/compression';

export class BaseOperator {
    constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000') {
        this.baseURL = baseURL;
    }

    async handleCompressedResponse(response) {
        const isCompressed = response.headers['x-data-compressed'] === 'true';
        if (!isCompressed) {
            return response.data;
        }

        // Handle compressed data
        if (response.data?.v === 1 && response.data?.c === true && response.data?.d) {
            // This is our compressed data format
            const decompressedData = await compression.decompress(response.data);
            return decompressedData;
        } else if (response.data?.items && Array.isArray(response.data.items)) {
            return response.data.items.map((item) => this.decompressItem(item));
        }

        // If the entire response is compressed (legacy format)
        return await compression.decompress(response.data);
    }

    // Helper method to decompress a single item if needed
    async decompressItem(item) {
        if (item?.v === 1 && item?.c === true && item?.d) {
            const decompressedItem = await compression.decompress(item);
            try {
                return typeof decompressedItem === 'string' ? JSON.parse(decompressedItem) : decompressedItem;
            } catch (e) {
                console.error('Error parsing decompressed item:', e);
                return decompressedItem;
            }
        }
        return item;
    }

    // Helper method for retrying API calls
    async retryApiCall(apiCall, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await apiCall();
                const data = await this.handleCompressedResponse(response);
                
                // Handle different response types
                if (Array.isArray(data)) {
                    // Decompress each item in the array if needed
                    return await Promise.all(data.map(item => this.decompressItem(item)));
                } else if (data?.items && Array.isArray(data.items)) {
                    // Handle paginated responses with items array
                    const decompressedItems = await Promise.all(data.items.map(item => this.decompressItem(item)));
                    return {
                        ...data,
                        items: decompressedItems
                    };
                }
                
                return data;
            } catch (error) {
                if (error.response?.status === 503 && i < retries - 1) {
                    console.log(`Retrying API call after 503 error (attempt ${i + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error;
            }
        }
    }
} 