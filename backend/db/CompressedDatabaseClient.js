/* requirements
- Implements all database operations with compression support
- Handles compression/decompression of values automatically
- Implements isConnected, isReady, encodeKey, hGetAll, zCard, zRange, zAdd, and del methods
- Maintains compatibility with both Redis and Firebase implementations
- Ensures proper type handling for Redis operations
- Adds debug logging for data types and values
- Supports atomic increments for hash fields
*/

import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { DatabaseCompression } from './DatabaseCompression.js';
import newLogger from '../logger.js';
const logger = newLogger("CompressedDatabaseClient.js");

export class CompressedDatabaseClient extends DatabaseClientInterface {
    constructor(dbClient, compression = new DatabaseCompression()) {
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

    async get(key, options = { returnCompressed: false }) {
        const compressedData = await this.db.get(key);
        if (!compressedData) return null;
        return options.returnCompressed ? compressedData : this.compression.decompress(compressedData);
    }

    async set(key, value) {
        const compressed = await this.compression.compress(value);
        return this.db.set(key, compressed);
    }

    async hGet(key, field, options = { returnCompressed: false }) {
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
            
            // Ensure we're working with string data
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

    async hSet(key, field, value) {
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

    async hGetAll(key, options = { returnCompressed: false }) {
        const compressedData = await this.db.hGetAll(key);
        if (!compressedData) return null;
        
        if (options.returnCompressed) {
            return compressedData;
        }

        // Decompress all values in the hash
        const decompressedData = {};
        for (const [field, value] of Object.entries(compressedData)) {
            decompressedData[field] = await this.compression.decompress(value);
        }
        return decompressedData;
    }

    async lPush(key, value) {
        const compressed = await this.compression.compress(value);
        return this.db.lPush(key, compressed);
    }

    async lRange(key, start, end, options = { returnCompressed: false }) {
        const compressedItems = await this.db.lRange(key, start, end);
        if (!compressedItems) return [];
        
        if (options.returnCompressed) {
            return compressedItems;
        }
        
        // Decompress all items in parallel
        const decompressedItems = await Promise.all(
            compressedItems.map(item => this.compression.decompress(item))
        );
        return decompressedItems;
    }

    async sAdd(key, value) {
        // For sets, we don't compress the values as they're often used as lookup keys
        return this.db.sAdd(key, value);
    }

    async sMembers(key) {
        // Set members are not compressed
        return this.db.sMembers(key);
    }

    async zAdd(key, score, value) {
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

    async zCard(key) {
        return this.db.zCard(key);
    }

    async zRange(key, start, end, options = { returnCompressed: false }) {
        const compressedItems = await this.db.zRange(key, start, end);
        if (!compressedItems) return [];
        
        if (options.returnCompressed) {
            return compressedItems;
        }
        
        // Decompress all items in parallel
        const decompressedItems = await Promise.all(
            compressedItems.map(item => this.compression.decompress(item))
        );
        return decompressedItems;
    }

    async del(key) {
        return this.db.del(key);
    }

    // Helper method to encode keys consistently
    encodeKey(key, prefix) {
        return this.db.encodeKey(key, prefix);
    }

    // Helper method to expose compression methods
    getCompression() {
        return this.compression;
    }

    async hIncrBy(key, field, increment) {
        // Note: We don't compress increment values as they're numeric
        return this.db.hIncrBy(key, field, increment);
    }
} 