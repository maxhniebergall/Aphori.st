import { deflate, inflate } from 'zlib';
import { promisify } from 'util';
import { Compressed } from '../types/index.js';

// Promisify zlib functions
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export class DatabaseCompression {
    private compressionThreshold: number;
    
    constructor(compressionThreshold = 100) {
        this.compressionThreshold = compressionThreshold;
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

    /**
     * Decompresses data previously compressed by this class.
     * Handles both compressed and uncompressed (but base64 encoded) formats based on metadata.
     * @param data The stringified compressed data object.
     * @returns {Promise<T>} The decompressed and parsed original data.
     * @throws {Error} If the input data is null/undefined, has an invalid format (missing fields),
     *                 or fails during base64 decoding or zlib inflation.
     *                 (Handled - Propagation: Error propagates up).
     */
    async decompress<T = any>(data: string): Promise<T> {
        if (!data) {
            // Handled - Propagation: Internal validation. Error would propagate through
            // CompressedDatabaseClient to the application layer if triggered.
            throw new Error('Data must not be null or undefined');
        }

        const parsed = JSON.parse(data) as Compressed<T>;
        
        if (!parsed.v || !parsed.d) {
            // Handled - Propagation: Internal validation for data format. Error would propagate
            // through CompressedDatabaseClient to the application layer if triggered.
            throw new Error('Invalid compressed data format');
        }

        const buf = Buffer.from(parsed.d, 'base64');
        

        // Treat undefined the same as false (back-compat)
        if (parsed.c === false || parsed.c === undefined) {
            if (parsed.c === undefined) {
                console.warn('DEPRECATED: Encountered legacy data format without compression flag. Support for this format will be removed in a future version.');
            }
            return JSON.parse(buf.toString());
        }


        const decompressed = await inflateAsync(buf);
        return JSON.parse(decompressed.toString());
    }
} 