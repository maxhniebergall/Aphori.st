import compression from '../utils/compression';

export class BaseOperator {
    constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000') {
        this.baseURL = baseURL;
    }

    async handleCompressedResponse(response) {
        const isCompressed = response.headers['x-data-compressed'] === 'true';
        const data = isCompressed ? await compression.decompress(response.data) : response.data;
        return data;
    }

    // Helper method for retrying API calls
    async retryApiCall(apiCall, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await apiCall();
                return await this.handleCompressedResponse(response);
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