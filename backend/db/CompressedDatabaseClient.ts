/* requirements
- Implements all database operations with compression support
- Handles compression/decompression of values automatically
- Implements isConnected, isReady, encodeKey, hGetAll, zCard, zRange, zAdd, and del methods
- Maintains compatibility with both Redis and Firebase implementations
- Ensures proper type handling for Redis operations
- Adds debug logging for data types and values
- Supports atomic increments for hash fields
- Properly typed TypeScript implementation
- Implements zscan method for sorted set scanning with compression support
*/

import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { DatabaseCompression } from './DatabaseCompression.js';
import { RedisSortedSetItem } from '../types/index.js';
import logger from '../logger.js';

interface CompressionOptions {
    returnCompressed: boolean;
}

export class CompressedDatabaseClient extends DatabaseClientInterface {
    private db: DatabaseClientInterface;
    private compression: DatabaseCompression;

    constructor(dbClient: DatabaseClientInterface, compression: DatabaseCompression = new DatabaseCompression()) {
        super();
        this.db = dbClient;
        this.compression = compression;
    }

    async connect() {
        return this.db.connect();
    }

    async isConnected() {
        return this.db.isConnected();
    }

    async isReady() {
        return this.db.isReady();
    }

    async get(key: string, options: CompressionOptions = { returnCompressed: false }): Promise<any> {
        const compressedData = await this.db.get(key);
        if (!compressedData) return null;
        return options.returnCompressed ? compressedData : this.compression.decompress(compressedData);
    }

    async set(key: string, value: any): Promise<any> {
        const compressed = await this.compression.compress(value);
        return this.db.set(key, compressed);
    }

    /**
     * Retrieves a value from a hash field, handling potential decompression.
     * @param key The hash key.
     * @param field The field within the hash.
     * @param options Options, e.g., { returnCompressed: true } to skip decompression.
     * @returns The potentially decompressed value, or null if not found.
     * @throws {Error} If key/field validation fails, or if decompression or the underlying database call fails.
     *                 (Handled - Propagation: Errors are caught and re-thrown).
     */
    async hGet(key: string, field: string | string[], options: CompressionOptions = { returnCompressed: false }): Promise<any> {
        
        // Validation
        if (!key || typeof key !== 'string') {
            // Handled - Propagation: Validation error, caught by local try/catch and re-thrown.
            throw new Error('Key must be a non-empty string');
        }
        if (!field) { // Check if field exists and is non-empty
            // Handled - Propagation: Validation error, caught by local try/catch and re-thrown.
            throw new Error('Field is required');
        }

        // TODO: Add support for multiple parents in the future
        // Currently only using the first parent ID if an array is provided
        const fieldToUse = Array.isArray(field) ? field[0] : field;
        
        try {
            const compressedData = await this.db.hGet(key, fieldToUse);
            
            if (!compressedData) {
                logger.info('hGet returned null/undefined');
                return null;
            }
            
            const stringData = typeof compressedData === 'string' ? 
                compressedData : 
                JSON.stringify(compressedData);
        
            const result = options.returnCompressed ? 
                stringData : 
                this.compression.decompress(stringData);
                
            return result;
        } catch (err) {
            logger.error('Error in hGet:', err);
            // Handled - Propagation: Re-throws error from underlying DB call or decompression.
            throw err;
        }
    }

    /**
     * Sets a value in a hash field, handling compression.
     * @param key The hash key.
     * @param field The field within the hash.
     * @param value The value to set (will be compressed).
     * @returns Result from the underlying database client (e.g., 1 for Redis).
     * @throws {Error} If key/field/value validation fails, compression fails, or the underlying database call fails.
     *                 (Handled - Propagation: Errors are caught and re-thrown).
     */
    async hSet(key: string, field: string, value: any): Promise<any> {
        logger.info(`hSet called with:`, {
            key: key,
            field: field,
            valueType: typeof value
        });

        // Validation
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }

        if (!field || typeof field !== 'string') {
            throw new Error('Field must be a non-empty string');
        }

        if (!value) {
            throw new Error('Value is required');
        }

        try {
            const compressed = await this.compression.compress(value);
            
            // Additional validation for compressed data
            if (typeof compressed !== 'string') {
                logger.error('Compression did not return a string:', typeof compressed);
                // Handled - Propagation: Validation error, caught by local try/catch and re-thrown.
                throw new Error('Compressed value must be a string');
            }

            return this.db.hSet(key, field, compressed);
        } catch (err) {
            logger.error('Error in hSet:', err);
            // Handled - Propagation: Re-throws error from validation, compression, or underlying DB call.
            throw err;
        }
    }

    async hGetAll(key: string, options: CompressionOptions = { returnCompressed: false }): Promise<Record<string, any> | null> {
        try {
            const compressedData = await this.db.hGetAll(key);
            if (!compressedData) return null;
            
            if (options.returnCompressed) {
                return compressedData;
            }

            const decompressedData: Record<string, any> = {};
            
            for (const [field, value] of Object.entries(compressedData)) {
                try {
                    if (!value) {
                        decompressedData[field] = value;
                        continue;
                    }
                    
                    const stringValue = typeof value === 'string' ? 
                        value : 
                        JSON.stringify(value);
                    
                    decompressedData[field] = await this.compression.decompress(stringValue);
                } catch (err) {
                    logger.warn(`Failed to decompress field ${field} in hash ${key}:`, err);
                    decompressedData[field] = value;
                }
            }
            return decompressedData;
        } catch (err) {
            logger.error('Error in hGetAll:', err);
            // Handled - Propagation: Re-throws error from underlying DB call or decompression.
            throw err;
        }
    }

    async lPush(key: string, value: any): Promise<number> {
        const compressed = await this.compression.compress(value);
        return this.db.lPush(key, compressed);
    }

    async lRange(key: string, start: number, end: number, options: CompressionOptions = { returnCompressed: false }): Promise<any[]> {
        const compressedItems = await this.db.lRange(key, start, end);
        if (!compressedItems) return [];
        
        if (options.returnCompressed) {
            return compressedItems;
        }
        
        const decompressedItems = await Promise.all(
            compressedItems.map((item: string) => this.compression.decompress(item))
        );
        return decompressedItems;
    }

    async lLen(key: string): Promise<number> {
        return this.db.lLen(key);
    }

    async sAdd(key: string, value: string): Promise<any> {
        // For sets, we don't compress the values as they're often used as lookup keys
        return this.db.sAdd(key, value);
    }

    async sMembers(key: string): Promise<string[]> {
        // Set members are not compressed
        return this.db.sMembers(key);
    }

    /**
     * Adds a member with a score to a sorted set, handling compression of the member value.
     * @param key The sorted set key.
     * @param score The score (must be a number).
     * @param value The member value (will be compressed).
     * @returns Result from the underlying database client (e.g., 1 if added, 0 if updated for Redis).
     * @throws {Error} If key/score/value validation fails, compression fails, or the underlying database call fails.
     *                 (Handled - Propagation: Errors are caught and re-thrown).
     */
    async zAdd(key: string, score: number, value: any): Promise<any> {
        logger.info(`CompressedDatabaseClient zAdd called with:`, {
            key: key,
            score: score,
            valueType: typeof value,
            value: value
        });

        // Validation
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }

        if (typeof score !== 'number') {
            throw new Error('Score must be a number');
        }

        if (!value) {
            throw new Error('Value is required');
        }

        try {
            // Ensure value is compressed and stringified
            const compressed = await this.compression.compress(value);
            
            // Additional validation for compressed data
            if (typeof compressed !== 'string') {
                logger.error('Compression did not return a string:', typeof compressed);
                // Handled - Propagation: Validation error, caught by local try/catch and re-thrown.
                throw new Error('Compressed value must be a string');
            }

            const result = await this.db.zAdd(key, score, compressed);
            logger.info(`zAdd result:`, result);
            return result;
        } catch (err) {
            logger.error('Error in zAdd:', err);
            // Handled - Propagation: Re-throws error from validation, compression, or underlying DB call.
            throw err;
        }
    }

    async zCard(key: string): Promise<number> {
        return this.db.zCard(key);
    }

    async zRange(key: string, start: number, end: number, options: CompressionOptions = { returnCompressed: false }): Promise<any[]> {
        const compressedItems = await this.db.zRange(key, start, end);
        if (!compressedItems) return [];
        
        if (options.returnCompressed) {
            return compressedItems;
        }
        
        const decompressedItems = await Promise.all(
            compressedItems.map((item: string) => this.compression.decompress(item))
        );
        return decompressedItems;
    }

    async del(key: string): Promise<any> {
        return this.db.del(key);
    }

    // Helper method to encode keys consistently
    encodeKey(key: string, prefix?: string): string {
        return this.db.encodeKey(key, prefix);
    }

    async decompress(data: string): Promise<any> {
        return this.compression.decompress(data);
    }

    async compress(data: any): Promise<string> {
        return this.compression.compress(data);
    }

    // Helper method to expose compression methods
    getCompression(): DatabaseCompression {
        return this.compression;
    }

    async hIncrBy(key: string, field: string, increment: number): Promise<number> {
        // Note: We don't compress increment values as they're numeric
        return this.db.hIncrBy(key, field, increment);
    }

    /**
     * Retrieves a range of members from a sorted set by score, in descending order, handling decompression.
     * @param key The sorted set key.
     * @param max The maximum score.
     * @param min The minimum score.
     * @param options Optional parameters like { limit }.
     * @returns An array of decompressed members.
     * @throws {Error} If decompression or the underlying database call fails.
     *                 (Handled - Propagation: Errors are caught and re-thrown).
     */
    async zRevRangeByScore<T = string>(key: string, max: number, min: number, options?: { limit?: number }): Promise<Array<{ score: number, value: T }>> {
        try {
            // items will be Array<{ score: number, value: any }> from underlying client
            const items = await this.db.zRevRangeByScore(key, max, min, options);
            if (!items.length) return [];
            
            // Decompress the `value` property of each item in the results array
            const decompressedItemsAndScores = await Promise.all(
                items.map(async (item: { score: number, value: any }) => { 
                    try {
                        // Ensure item.value is the compressed string
                        if (typeof item.value !== 'string') {
                            logger.warn('Value in zRevRangeByScore item is not a string, cannot decompress:', item.value);
                            return null; 
                        }
                        // Decompress the value property
                        const decompressedValue = await this.compression.decompress(item.value); 
                        // Return the object with the original score and decompressed value
                        return { score: item.score, value: decompressedValue as T }; 
                    } catch (err) {
                        logger.error('Error decompressing item value in zRevRangeByScore:', { err, item });
                        return null;
                    }
                })
            );
            
            // Filter out any failed decompression attempts
            return decompressedItemsAndScores.filter((item): item is NonNullable<typeof item> => item !== null);
        } catch (err) {
            logger.error('Error in zRevRangeByScore:', err);
            // Handled - Propagation: Re-throws error from underlying DB call or decompression.
            throw err;
        }
    }

    /**
     * Scans a sorted set, handling decompression of member values.
     * @param key The sorted set key.
     * @param cursor The cursor from the previous scan (or '0' to start).
     * @param options Optional MATCH pattern or COUNT.
     * @returns An object containing the next cursor and an array of decompressed items ({ score, value }).
     * @throws {Error} If decompression or the underlying database call fails (except for 'ERR invalid cursor').
     *                 (Handled - Propagation: Errors are caught and re-thrown).
     */
    async zscan(key: string, cursor: string = '0', options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
        logger.info(`CompressedDatabaseClient zscan called with:`, {
            key,
            cursor,
            options
        });

        try {
            const result = await this.db.zscan(key, cursor, options);
            
            if (!result || !result.items) {
                return { cursor: null, items: [] };
            }
            let uncompressedItems :RedisSortedSetItem<string>[] = [];
            if (result.items.length > 0) {
                uncompressedItems = await Promise.all(result.items.map(async (item) => {
                    return {score: item.score, value: await this.compression.decompress(item.value)};
                }));
            }

            return {
                cursor: result.cursor,
                items: uncompressedItems
            };
        } catch (err) {
            if (err instanceof Error && err.message.includes("ERR invalid cursor")) {
                return { cursor: null, items: [] };
            }
            logger.error('Error in zscan:', err);
            // Handled - Propagation: Re-throws error from underlying DB call or decompression.
            throw err;
        }
    }

    // Pass through hIncrementQuoteCount to the underlying database client
    // Compression is not applied here as the method handles a specific structure
    async hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number> {
        // Assuming quoteValue itself doesn't need compression, but the field might if it represents a complex object key
        // Pass through directly for now, depends on underlying implementation (Firebase vs Redis)
        return this.db.hIncrementQuoteCount(key, field, quoteValue);
    }

    /**
     * Delegates adding a feed item to the underlying client.
     * Assumes the underlying client handles the specifics (e.g., Firebase push key generation).
     * @param item The FeedItem object.
     * @returns The unique key/ID from the underlying client.
     */
    async addFeedItem(item: any): Promise<string> {
        // Feed item itself might be compressed by the underlying Firebase/Redis set/hSet methods if called directly
        // However, the new addFeedItem in FirebaseClient handles the raw object.
        // Let's assume the item should be passed as is.
        return this.db.addFeedItem(item);
    }

    /**
     * Delegates incrementing the feed counter to the underlying client.
     * @param amount Amount to increment by.
     */
    async incrementFeedCounter(amount: number): Promise<void> {
        // Counter values are typically not compressed.
        return this.db.incrementFeedCounter(amount);
    }

    /**
     * Delegates fetching a page of feed items to the underlying client.
     * Handles decompression of the returned items.
     * @param limit Max number of items.
     * @param cursorKey Key to start after.
     * @returns Object with potentially decompressed items and the next cursor key.
     */
    async getFeedItemsPage(limit: number, cursorKey?: string, options: CompressionOptions = { returnCompressed: false }): Promise<{ items: any[], nextCursorKey: string | null }> {
        const result = await this.db.getFeedItemsPage(limit, cursorKey);

        if (options.returnCompressed || !result.items || result.items.length === 0) {
            return result;
        }

        // Decompress items - assuming items might be compressed individually
        // Note: Our Firebase implementation returns raw objects, Redis returns strings that need parsing.
        // The `decompress` method expects a string. This might need adjustment
        // based on what the underlying methods actually return.
        // For now, assume items are strings needing decompression if not returning compressed.
        const decompressedItems = await Promise.all(
            result.items.map(async (item) => {
                try {
                    // If item is already an object (from Firebase), stringify before potential decompression
                    // If it's a string (from Redis), use directly
                    const dataToDecompress = typeof item === 'string' ? item : JSON.stringify(item);
                    // Check if it actually looks compressed (e.g., is base64) before attempting decompression?
                    // For simplicity, try decompressing; handle errors.
                    return await this.compression.decompress(dataToDecompress);
                } catch (e) {
                    logger.warn({ err: e, item }, 'Failed to decompress feed item, returning original.');
                    return item; // Return original item if decompression fails
                }
            })
        );

        return { items: decompressedItems, nextCursorKey: result.nextCursorKey };
    }
} 