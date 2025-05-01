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
    compress(value: unknown): string {
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
     * @throws {Error} If value is null/undefined, format is invalid, version mismatch, Base64 decoding fails,
     *                 pako decompression fails, or JSON parsing fails.
     *                 (Handled - Propagation / Depends on Caller).
     */
    decompress<T>(value: Compressed<T>): T | null {
        try {
            if (!value) {
                // Handled - Depends on Caller: Internal validation. Calling code should handle.
                throw new Error('No value provided');
            }
            if (typeof value !== 'object') {
                throw new Error('Value is not of expected type, was [' + typeof value + ']');
            }
            if (value.c === false) {
                const isb64 = isBase64(value.d);
                
                if (typeof value.d === 'object' && value.d !== null) {
                    return value.d as T;
                }

                // New check for Base64 encoding
                if (typeof value.d === 'string' && isb64) {
                    const decoded = Buffer.from(value.d, 'base64');
                    const text = new TextDecoder().decode(decoded);
                    return JSON.parse(text) as T;
                }

                // Handled - Depends on Caller: Internal validation. Calling code should handle.
                throw new Error('Value is not of expected type');
            }
            if (!value.d) {
                // Handled - Depends on Caller: Internal validation. Calling code should handle.
                throw new Error('No compressed data found');
            }
            if (value.v !== 1) {
                // Handled - Depends on Caller: Internal validation. Calling code should handle.
                throw new Error('Unsupported version: ' + value.v);
            }
            const compressed = Buffer.from(value.d, 'base64');
            const decompressed = pako.inflate(compressed);
            const text = new TextDecoder().decode(decompressed);
            try {
                return JSON.parse(text) as T;
            } catch (e) {
                console.error('Compression: Failed to parse decompressed JSON:', e);
                // Handled - Propagation: Re-throws JSON parsing error. Caller should handle.
                throw e;
            }
        } catch (e) {
            console.error('Compression: Failed to decompress value:', e);
            // Handled - Propagation: Re-throws error from pako or other issues. Caller should handle.
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
     * @throws {Error} If input is not a string or object, or if Base64 decoding or JSON parsing fails.
     *                 (Handled - Depends on Caller).
     */
     unencode<T>(value: T): T;
     unencode<T>(value: string): T;
     unencode<T>(value: string | T): T {
        if (typeof value !== 'string') {
            if (typeof value === 'object' && value !== null) {
                return value as T;
            }
            // Handled - Depends on Caller: Internal validation. Calling code should handle.
            throw new Error('Value is not of expected type');        
        }
        const encoded = Buffer.from(value, 'base64');
        const text = new TextDecoder().decode(encoded);
        return JSON.parse(text) as T;
    }
}

// Create a singleton instance
const compression = new DatabaseCompression();
export default compression;

// New helper function to check if a string is Base64 encoded
function isBase64(str: string): boolean {
    const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
    return base64Pattern.test(str) && (str.length % 4 === 0);
} 