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
        }

        // If the entire response is compressed (legacy format)
        return await compression.decompress(response.data);
    }

    // Helper method for retrying API calls
    async retryApiCall(apiCall, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await apiCall();
                const data = await this.handleCompressedResponse(response);
                
                // Parse any stringified JSON in the response
                if (Array.isArray(data)) {
                    return data.map(item => {
                        try {
                            return typeof item === 'string' ? JSON.parse(item) : item;
                        } catch (e) {
                            console.error('Error parsing item:', e);
                            return item; // Return original if parsing fails
                        }
                    });
                } else if (data?.items && Array.isArray(data.items)) {
                    return {
                        ...data,
                        items: data.items.map(item => {
                            try {
                                return typeof item === 'string' ? JSON.parse(item) : item;
                            } catch (e) {
                                console.error('Error parsing item:', e);
                                return item; // Return original if parsing fails
                            }
                        })
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