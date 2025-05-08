import axios, { AxiosResponse } from 'axios';
// Removed: import { BaseOperator } from './BaseOperator';
import { FeedItemsResponse } from '../types/types';

/**
 * Requirements:
 * - Handle API response data (decompression now handled by browser).
 * - Support pagination with cursor-based navigation.
 * - Return feed items in a format compatible with the Feed component.
 * - Properly handle errors and edge cases.
 *
 */
class FeedOperator {
    private baseURL: string;

    // Queue properties
    private requestQueue: Array<{ cursor: string, resolve: (value: any) => void, reject: (reason?: any) => void }> = [];
    private isProcessingQueue = false;

    constructor(baseURL: string = process.env.REACT_APP_API_URL || 'http://localhost:5050') {
        this.baseURL = baseURL;
    }

    // Simple sleep helper
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public getFeedItems(cursor: string): Promise<{ success: boolean; data?: FeedItemsResponse['data']; pagination?: FeedItemsResponse['pagination']; error?: string; }> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ cursor, resolve, reject });
            this._tryProcessQueue();
        });
    }

    private async _tryProcessQueue(): Promise<void> {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        const requestToProcess = this.requestQueue.shift();

        if (!requestToProcess) { // Should theoretically not happen if length > 0
            this.isProcessingQueue = false;
            return;
        }

        const { cursor, resolve, reject } = requestToProcess;

        try {
            // Generate time bucket for cache-friendly URL
            const currentTime = Date.now();
            const timeBucket = Math.floor(currentTime / (60 * 1000)) * (60 * 1000);

            const response: AxiosResponse<FeedItemsResponse> = await axios.get(`${this.baseURL}/api/feed`, {
                params: { 
                    cursor, 
                    t: timeBucket 
                },
                validateStatus: status => status === 200
            });

            const responseData = response.data;

            if (responseData?.data && Array.isArray(responseData.data) && responseData.pagination) {
                resolve({
                    success: true,
                    data: responseData.data,
                    pagination: responseData.pagination
                });
            } else {
                console.error("Invalid feed data structure:", responseData);
                reject({
                    success: false,
                    error: "Invalid feed data structure"
                });
            }
        } catch (error: unknown) {
            console.error(`Error fetching feed items for cursor "${cursor}":`, error);
            const errorMessage = error instanceof Error 
                ? error.message 
                : 'Failed to fetch feed items';
            const axiosError = error as { response?: { data?: { error?: string } } };
            reject({
                success: false,
                error: axiosError.response?.data?.error || errorMessage
            });
        } finally {
            this.isProcessingQueue = false;
            // Use setTimeout to yield to the event loop before processing the next item
            setTimeout(() => this._tryProcessQueue(), 0);
        }
    }
}

export const feedOperator = new FeedOperator();