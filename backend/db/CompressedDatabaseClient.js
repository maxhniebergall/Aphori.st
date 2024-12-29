import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { DatabaseCompression } from './DatabaseCompression.js';

export class CompressedDatabaseClient extends DatabaseClientInterface {
    constructor(dbClient, compression = new DatabaseCompression()) {
        super();
        this.db = dbClient;
        this.compression = compression;
    }

    async connect() {
        return this.db.connect();
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
        const compressedData = await this.db.hGet(key, field);
        if (!compressedData) return null;
        return options.returnCompressed ? compressedData : this.compression.decompress(compressedData);
    }

    async hSet(key, field, value) {
        const compressed = await this.compression.compress(value);
        return this.db.hSet(key, field, compressed);
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

    // Helper method to encode keys consistently
    encodeKey(key, prefix) {
        return this.compression.encodeKey(key, prefix);
    }

    // Helper method to expose compression methods
    getCompression() {
        return this.compression;
    }
} 