import { deflate, inflate } from 'zlib';
import { promisify } from 'util';

// Promisify zlib functions
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export class DatabaseCompression {
    constructor(compressionThreshold = 100) {
        this.compressionThreshold = compressionThreshold;
    }

    encodeKey(key, prefix) {
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }
        return `${prefix}:${key.replace(/[.#$[\]]/g, '_')}`;
    }

    async compress(data) {
        const jsonStr = JSON.stringify(data);
        
        // Only compress if the data is large enough to benefit
        if (jsonStr.length < this.compressionThreshold) {
            return JSON.stringify({
                v: 1,
                c: false,
                d: Buffer.from(jsonStr).toString('base64')
            });
        }

        const compressed = await deflateAsync(Buffer.from(jsonStr));
        return JSON.stringify({
            v: 1,
            c: true,
            d: compressed.toString('base64')
        });
    }

    async decompress(data) {
        if (!data) {
            throw new Error('Data must not be null or undefined');
        }

        const parsed = JSON.parse(data);
        
        if (!parsed.v || !parsed.d) {
            throw new Error('Invalid compressed data format');
        }

        const buf = Buffer.from(parsed.d, 'base64');
        
        if (!parsed.c) {
            return JSON.parse(buf.toString());
        }

        const decompressed = await inflateAsync(buf);
        return JSON.parse(decompressed.toString());
    }
} 