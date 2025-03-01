import { deflate, inflate } from 'zlib';
import { promisify } from 'util';
import { Compressed } from '../types';

// Promisify zlib functions
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export class DatabaseCompression {
    private compressionThreshold: number;
    
    constructor(compressionThreshold = 100) {
        this.compressionThreshold = compressionThreshold;
    }

    encodeKey(key: string, prefix: string): string {
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }
        return `${prefix}:${key.replace(/[.#$[\]]/g, '_')}`;
    }

    async compress<T = any>(data: T): Promise<string> {
        const jsonStr = JSON.stringify(data);
        
        // Only compress if the data is large enough to benefit
        if (jsonStr.length < this.compressionThreshold) {
            return JSON.stringify({
                v: 1,
                c: false,
                d: Buffer.from(jsonStr).toString('base64')
            } as Compressed<T>);
        }

        const compressed = await deflateAsync(Buffer.from(jsonStr));
        return JSON.stringify({
            v: 1,
            c: true,
            d: compressed.toString('base64')
        } as Compressed<T>);
    }

    async decompress<T = any>(data: string): Promise<T> {
        if (!data) {
            throw new Error('Data must not be null or undefined');
        }

        const parsed = JSON.parse(data) as Compressed<T>;
        
        if (!parsed.v || !parsed.d) {
            throw new Error('Invalid compressed data format');
        }

        const buf = Buffer.from(parsed.d, 'base64');
        
        if (parsed.c === false) {
            return JSON.parse(buf.toString());
        }

        const decompressed = await inflateAsync(buf);
        return JSON.parse(decompressed.toString());
    }
} 