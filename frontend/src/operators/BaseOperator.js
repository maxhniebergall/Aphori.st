import compression from '../utils/compression';

export class BaseOperator {
    constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000') {
        this.baseURL = baseURL;
    }

    async handleCompressedResponse(response) {
        const isCompressed = response.headers['x-data-compressed'] === 'true';
        if (isCompressed || (response.data?.v === 1 && response.data?.c === true && response.data?.d) || response.data?.items) {
            // Handle compressed data
            if (response.data?.v === 1 && response.data?.c === true && response.data?.d) {
                console.log("BaseOperator: data is compressed as single item");
                // This is our compressed data format
                const decompressedData = await this.decompressItem(response.data);
                return decompressedData;
            } else if (response.data?.items && Array.isArray(response.data.items)) {
                console.log("BaseOperator: data is compressed as array of items");
                return response.data.items.map((item) => this.decompressItem(item));
            }

        
            // If the entire response is compressed (legacy format)
            console.log("BaseOperator: data is compressed as entire response");
            return await compression.decompress(response.data);
        } else if (response.data?.v ===1 && response.data?.c === false && response.data?.d) {
            console.log("BaseOperator: data is encoded as entire response");
            return compression.unencode(response.data.d);  
        } else {
            console.log("BaseOperator: data is not compressed", response.data);
            return response.data;
        }
    }

    // Helper method to decompress a single item if needed
    async decompressItem(item) {
        const itemObject = typeof item === 'string' ? JSON.parse(item) : item;  
        console.log("BaseOperator: decompressing item", itemObject);
        if (itemObject?.v === 1 && itemObject?.c === true && itemObject?.d) {
            const decompressedItem = await compression.decompress(itemObject.d);
            console.log("BaseOperator: decompressed item", decompressedItem);

            try {
                if (typeof decompressedItem === 'string') {
                    return JSON.parse(decompressedItem)
                } else {
                    return decompressedItem;
                }
            } catch (e) {
                console.error('Error parsing decompressed item:', e);
                return decompressedItem;
            }
        } else if (itemObject?.v === 1 && itemObject?.c === false && itemObject?.d) {
            console.log("BaseOperator: data is encoded as item");
            const unencodedItem = await compression.unencode(itemObject.d);
            if (typeof unencodedItem === 'string') {
                return JSON.parse(unencodedItem);
            } else {
                return unencodedItem;
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