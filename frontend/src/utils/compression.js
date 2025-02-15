import pako from 'pako';
import { Buffer } from 'buffer';

export class DatabaseCompression {
    async compress(value) {
        if (typeof value !== 'string') {
            value = JSON.stringify(value);
        }
        const uint8Array = new TextEncoder().encode(value);
        const compressed = pako.deflate(uint8Array);
        return Buffer.from(compressed).toString('base64');
    }

    async decompress(value) {
        if (!value) {
            console.warn('Compression: Received null or undefined value to decompress');
            return null;
        }
        try {
            const compressed = Buffer.from(value, 'base64');
            const decompressed = pako.inflate(compressed);
            const text = new TextDecoder().decode(decompressed);
            try {
                return JSON.parse(text);
            } catch (e) {
                console.warn('Compression: Failed to parse decompressed JSON:', e);
                return text;
            }
        } catch (e) {
            console.error('Compression: Failed to decompress value:', e);
            throw e;
        }
    }

    async unencode(value) {
        if (typeof value !== 'string') {
            return value;
        }
        const encoded = Buffer.from(value, 'base64');
        const text = new TextDecoder().decode(encoded);
        return JSON.parse(text);
    }
}

// Create a singleton instance
const compression = new DatabaseCompression();
export default compression; 