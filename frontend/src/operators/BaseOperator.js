import compression from '../utils/compression';

export class BaseOperator {
    constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000') {
        this.baseURL = baseURL;
    }

    async handleCompressedResponse(response) {
        try {
            const isCompressed = response.headers['x-data-compressed'] === 'true';
            const responseData = response.data;

            // Log the response structure for debugging
            console.log("BaseOperator: Response structure:", {
                isCompressed,
                hasVersion: responseData?.v !== undefined,
                isCompressed: responseData?.c === true,
                hasData: responseData?.d !== undefined,
                hasItems: responseData?.items !== undefined
            });

            if (isCompressed || (responseData?.v === 1 && responseData?.c === true && responseData?.d) || responseData?.items) {
                // Handle compressed data
                if (responseData?.v === 1 && responseData?.c === true && responseData?.d) {
                    console.log("BaseOperator: Processing compressed single item");
                    const decompressedData = await this.decompressItem(responseData);
                    console.log("BaseOperator: Successfully decompressed single item");
                    return decompressedData;
                } else if (responseData?.items && Array.isArray(responseData.items)) {
                    console.log("BaseOperator: Processing compressed array of items");
                    const decompressedItems = await Promise.all(responseData.items.map(item => this.decompressItem(item)));
                    console.log("BaseOperator: Successfully decompressed array items");
                    return decompressedItems;
                }

                // If the entire response is compressed (legacy format)
                console.log("BaseOperator: Processing legacy compressed response");
                const decompressedResponse = await compression.decompress(responseData);
                console.log("BaseOperator: Successfully decompressed legacy response");
                return decompressedResponse;
            } else if (responseData?.v === 1 && responseData?.c === false && responseData?.d) {
                console.log("BaseOperator: Processing encoded response");
                const unencodedResponse = compression.unencode(responseData.d);
                console.log("BaseOperator: Successfully unencoded response");
                return unencodedResponse;
            } else {
                console.log("BaseOperator: Response is not compressed, returning as is");
                return responseData;
            }
        } catch (error) {
            console.error("BaseOperator: Error handling compressed response:", error);
            throw error;
        }
    }

    // Helper method to decompress a single item if needed
    async decompressItem(item) {
        try {
            const itemObject = typeof item === 'string' ? JSON.parse(item) : item;
            console.log("BaseOperator: Decompressing item structure:", {
                hasVersion: itemObject?.v !== undefined,
                isCompressed: itemObject?.c === true,
                hasData: itemObject?.d !== undefined
            });

            if (itemObject?.v === 1 && itemObject?.c === true && itemObject?.d) {
                console.log("BaseOperator: Decompressing compressed item");
                const decompressedItem = await compression.decompress(itemObject.d);
                console.log("BaseOperator: Successfully decompressed item");

                try {
                    if (typeof decompressedItem === 'string') {
                        return JSON.parse(decompressedItem);
                    } else {
                        return decompressedItem;
                    }
                } catch (e) {
                    console.error('BaseOperator: Error parsing decompressed item:', e);
                    return decompressedItem;
                }
            } else if (itemObject?.v === 1 && itemObject?.c === false && itemObject?.d) {
                console.log("BaseOperator: Unencoding item");
                const unencodedItem = await compression.unencode(itemObject.d);
                if (typeof unencodedItem === 'string') {
                    return JSON.parse(unencodedItem);
                } else {
                    return unencodedItem;
                }
            }

            return item;
        } catch (error) {
            console.error("BaseOperator: Error decompressing item:", error);
            throw error;
        }
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