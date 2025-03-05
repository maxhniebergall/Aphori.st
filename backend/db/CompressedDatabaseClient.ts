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
import newLogger from '../logger.js';

const logger = newLogger("CompressedDatabaseClient.js");

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

    async hGet(key: string, field: string | string[], options: CompressionOptions = { returnCompressed: false }): Promise<any> {
        logger.info(`hGet called with key: ${key}, field: ${field}`);
        
        // Validation
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }

        if (!field) {
            throw new Error('Field is required');
        }

        // TODO: Add support for multiple parents in the future
        // Currently only using the first parent ID if an array is provided
        const fieldToUse = Array.isArray(field) ? field[0] : field;
        
        try {
            const compressedData = await this.db.hGet(key, fieldToUse);
            logger.info(`hGet raw data type: ${typeof compressedData}`, { data: compressedData });
            
            if (!compressedData) {
                logger.info('hGet returned null/undefined');
                return null;
            }
            
            const stringData = typeof compressedData === 'string' ? 
                compressedData : 
                JSON.stringify(compressedData);
            
            logger.info(`hGet processed data type: ${typeof stringData}`);
            
            const result = options.returnCompressed ? 
                stringData : 
                this.compression.decompress(stringData);
                
            logger.info(`hGet final result type: ${typeof result}`);
            return result;
        } catch (err) {
            logger.error('Error in hGet:', err);
            throw err;
        }
    }

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
                throw new Error('Compressed value must be a string');
            }

            return this.db.hSet(key, field, compressed);
        } catch (err) {
            logger.error('Error in hSet:', err);
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
            throw err;
        }
    }

    async lPush(key: string, value: any): Promise<any> {
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
                throw new Error('Compressed value must be a string');
            }

            const result = await this.db.zAdd(key, score, compressed);
            logger.info(`zAdd result:`, result);
            return result;
        } catch (err) {
            logger.error('Error in zAdd:', err);
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

    async zRevRangeByScore<T = string>(key: string, max: number, min: number, options?: { limit?: number }): Promise<T[]> {
        try {
            const items = await this.db.zRevRangeByScore(key, max, min, options);
            if (!items.length) return [];
            
            const decompressedItems = await Promise.all(
                items.map(async (item) => {
                    try {
                        // Parse the outer string if it's stringified JSON
                        const parsedItem = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
                        const decompressed = await this.compression.decompress(parsedItem);
                        return decompressed as T;
                    } catch (err) {
                        logger.error('Error parsing/decompressing item:', err);
                        return null;
                    }
                })
            );
            
            // Filter out any failed decompression attempts and cast to T[]
            return decompressedItems.filter((item): item is NonNullable<typeof item> => item !== null) as T[];
        } catch (err) {
            logger.error('Error in zRevRangeByScore:', err);
            throw err;
        }
    }

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
            throw err;
        }
    }
} 