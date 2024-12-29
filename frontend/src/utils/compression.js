import pako from 'pako';

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
        if (!value) return null;
        const compressed = Buffer.from(value, 'base64');
        const decompressed = pako.inflate(compressed);
        const text = new TextDecoder().decode(decompressed);
        try {
            return JSON.parse(text);
        } catch (e) {
            return text;
        }
    }
}

// Create a singleton instance
const compression = new DatabaseCompression();
export default compression; 