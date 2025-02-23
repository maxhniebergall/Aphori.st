import pako from 'pako';
import { Buffer } from 'buffer';
import { Compressed } from '../types/compressed';

export class DatabaseCompression {
    /**
     * Compresses a given value (either a string or any serializable object) into a Base64 encoded string.
     *
     * @param value - The value to compress.
     * @returns A promise that resolves to the Base64 encoded compressed string.
     */
    async compress(value: unknown): Promise<string> {
        let stringValue: string;
        if (typeof value !== 'string') {
            stringValue = JSON.stringify(value);
        } else {
            stringValue = value;
        }
        const uint8Array = new TextEncoder().encode(stringValue);
        const compressed = pako.deflate(uint8Array);
        return Buffer.from(compressed).toString('base64');
    }

    /**
     * Decompresses a Base64 encoded string.
     * If the decompressed text is valid JSON, it attempts to parse it.
     *
     * @param value - The Base64 encoded compressed string (or null/undefined).
     * @returns A promise that resolves to the parsed object, the raw decompressed string, or null.
     */
    async decompress<T = unknown, V = unknown>(value: Compressed<T>): Promise<V | null> {
        try {
            console.log("Compression: Decompressing value:", value," type: ", typeof value);
            if (!value) {
                throw new Error('No value provided');
            }
            if (value.c === false) {
                console.log("Compression: Value is not compressed, returning as is");
                return value as V;
            }
            if (!value.d) {
                throw new Error('No compressed data found');
            }
            if (value.v !== 1) {
                throw new Error('Unsupported version: ' + value.v);
            }
            console.log("Compression: Decompressing value:", value);
            const compressed = Buffer.from(value.d, 'base64');
            console.log("Compression: Decompressed value:", compressed);
            const decompressed = pako.inflate(compressed);
            console.log("Compression: Decompressed value:", decompressed);
            const text = new TextDecoder().decode(decompressed);
            try {
                return JSON.parse(text) as V;
            } catch (e) {
                console.error('Compression: Failed to parse decompressed JSON:', e);
                throw e;
            }
        } catch (e) {
            console.error('Compression: Failed to decompress value:', e);
            throw e;
        }
    }

    /**
     * Overloaded unencode method.
     * If the input is not a string, it is immediately returned.
     * Otherwise, the method decodes the Base64 encoded string and parses it as JSON.
     *
     * @param value - A Base64 encoded string or already decoded value.
     * @returns A promise that resolves to the decoded value.
     */
    async unencode<T>(value: T): Promise<T>;
    async unencode<T>(value: string): Promise<T>;
    async unencode<T>(value: string | T): Promise<T> {
        if (typeof value !== 'string') {
            return value as T;
        }
        const encoded = Buffer.from(value, 'base64');
        const text = new TextDecoder().decode(encoded);
        return JSON.parse(text) as T;
    }
}

// Create a singleton instance
const compression = new DatabaseCompression();
export default compression; 