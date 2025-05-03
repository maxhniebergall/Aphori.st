/**
 * Requirements:
 * - Use generics for typed response handling.
 * - Support decompression operations for both single item and array of items.
 * - Support legacy unencoding responses.
 * - Provide a retry mechanism for API calls.
 * - Properly type all variables, including ensuring 'items' property is detected within the response.
 * - Ensure no use of implicit 'any' types.
 * - Use generics in decompressItem to precisely type decompressed items.
 */

import compression from '../utils/compression';
import { AxiosResponse } from 'axios';
import { CompressedApiResponse } from '../types/types';
import { Compressed } from '../types/compressed';

// Interface to represent objects with an 'items' property.
interface HasItems<T = unknown> {
  items: T[];
}

export class BaseOperator {
  public baseURL: string;
  
  constructor(baseURL: string = process.env.REACT_APP_API_URL || 'http://localhost:5000') {
    this.baseURL = baseURL;
  }

  /**
   * Generic method to handle responses with potential compression.
   * 
   * @param response - The AxiosResponse object.
   * @returns A promise resolving to the decompressed data of type T.
   * @throws {Error} If handling the compressed response (e.g., decompression) fails.
   *                 (Handled - Propagation: Re-throws error to calling operator).
   */
  async handleCompressedResponse<T = unknown>(response: AxiosResponse): Promise<T> {
    try {
      const isCompressed = response.headers['x-data-compressed'] === 'true';
      const responseData = response.data;

      if (isCompressed || (responseData?.v === 1 && responseData?.c === true && responseData?.d) || responseData?.items) {
        // Handle single compressed item
        if (responseData?.v === 1 && responseData?.c === true && responseData?.d) {
          const decompressedData = await this.decompressItem<T>(responseData);
          return decompressedData;
        } 
        // Handle compressed array of items
        else if (responseData?.items && Array.isArray(responseData.items)) {
          const decompressedItems = await Promise.all(
            responseData.items.map((item: unknown) => this.decompressItem<any>(item))
          );
          return decompressedItems as unknown as T;
        }

        // Legacy compressed response
        const decompressedResponse = await compression.decompress(responseData);
        return decompressedResponse as T;
      } else if (responseData?.v === 1 && responseData?.c === false && responseData?.d) {
        const unencodedResponse = compression.unencode(responseData.d);
        return unencodedResponse as T;
      } else {
        return responseData as T;
      }
    } catch (error) {
      console.error("BaseOperator: Error handling compressed response:", error);
      // Handled - Propagation: Re-throws error (e.g., from decompression) to the calling operator.
      throw error;
    }
  }

  /**
   * Helper method to decompress a single item if needed.
   *
   * @param item - The compressed item or stringified JSON.
   * @returns A promise resolving to the decompressed item of type T.
   * @throws {Error} If decompressing or parsing the item fails.
   *                 (Handled - Propagation: Re-throws error to calling operator).
   */
  async decompressItem<T = unknown>(item: any): Promise<T> {
    try {
      const itemObject = typeof item === 'string' ? JSON.parse(item) : item;

      if (itemObject?.v === 1 && itemObject?.c === true && itemObject?.d) {
        const decompressedItem = await compression.decompress(itemObject.d);
        try {
          if (typeof decompressedItem === 'string') {
            return JSON.parse(decompressedItem) as T;
          } else {
            return decompressedItem as T;
          }
        } catch (e) {
          console.error('BaseOperator: Error parsing decompressed item:', e);
          return decompressedItem as T;
        }
      } else if (itemObject?.v === 1 && itemObject?.c === false && itemObject?.d) {
        const unencodedItem = await compression.unencode(itemObject.d);
        if (typeof unencodedItem === 'string') {
          return JSON.parse(unencodedItem) as T;
        } else {
          return unencodedItem as T;
        }
      }

      return item as T;
    } catch (error) {
      console.error("BaseOperator: Error decompressing item:", error);
      // Handled - Propagation: Re-throws error (e.g., from decompression) to the calling operator.
      throw error;
    }
  }

  /**
   * Helper method for retrying API calls.
   *
   * @param apiCall - A function that performs the API call and returns an AxiosResponse.
   * @param retries - The maximum number of retry attempts (default is 3).
   * @param delay - The delay between retries in milliseconds (default is 1000).
   * @returns A promise that resolves to the processed response data of type T.
   * 
   * @throws {Error} If the API call fails (non-503 status) or returns success:false.
   * @throws {Error} If the maximum number of retries is exceeded.
   *                 (Handled - Propagation: Errors propagated to calling operator).
   */
  async retryApiCallSimplified<T = unknown>(apiCall: () => Promise<AxiosResponse<CompressedApiResponse<T>>>, retries = 3, delay = 1000): Promise<Compressed<T>> {
    for (let i = 0; i < retries; i++) {
      try {
        const response: AxiosResponse<CompressedApiResponse<T>> = await apiCall();
        if (response.data.success && response.data.compressedData) {
          if (typeof response.data.compressedData === 'string') {
            return JSON.parse(response.data.compressedData) as Compressed<T>;
          } else {
            return response.data.compressedData;
          }
        } else {
          throw new Error(response.data.error || 'Unknown error, backend returned: ' + JSON.stringify(response.data));
        }
      } catch (error: any) {
        if (error.response && error.response.status === 503 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // Handled - Propagation: Re-throws non-retryable API errors or errors after retries,
        // propagated to the calling operator.
        throw error;
      }
    }
    // Handled - Propagation: Throws error after max retries exceeded, propagated to calling operator.
    throw new Error("Max retries exceeded");
  }

    /**
   * Helper method for retrying API calls.
   *
   * @param apiCall - A function that performs the API call and returns an AxiosResponse.
   * @param retries - The maximum number of retry attempts (default is 3).
   * @param delay - The delay between retries in milliseconds (default is 1000).
   * @returns A promise that resolves to the processed response data of type T.
   * @deprecated: this is a weird method that implements both API call retrying and decompression.
   * TODO: refactor to use retryApiCallSimplified instead (then rename retryApiCallSimplified sto retryApiCall)
   */
    async retryApiCall<T = unknown>(apiCall: () => Promise<AxiosResponse>, retries = 3, delay = 1000): Promise<T> {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await apiCall();
          const data = await this.handleCompressedResponse<T>(response);
          
          if (Array.isArray(data)) {
            // If the caller expects an array, infer the element type
            type ElementType = T extends (infer U)[] ? U : unknown;
            const decompressedItems = await Promise.all(
              (data as unknown[]).map((item: unknown) => this.decompressItem<ElementType>(item))
            );
            return decompressedItems as T;
          } else if (this.isHasItems(data)) {
            // If the response has an 'items' array property, infer its element type
            type ElementType = T extends { items: (infer U)[] } ? U : unknown;
            const decompressedItems = await Promise.all(
              data.items.map((item: unknown) => this.decompressItem<ElementType>(item))
            );
            return {
              ...data,
              items: decompressedItems
            } as T;
          }
          
          return data;
        } catch (error: any) {
          if (error.response?.status === 503 && i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }
      throw new Error("Max retries exceeded");
    }

  /**
   * Type guard to check if an object has an 'items' property which is an array.
   * 
   * @param obj - The object to check.
   * @returns True if the object conforms to the HasItems interface.
   */
  private isHasItems(obj: any): obj is HasItems {
    return obj !== null && typeof obj === 'object' && Array.isArray(obj.items);
  }
} 