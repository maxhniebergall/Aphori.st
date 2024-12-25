import { DatabaseCompression } from './DatabaseCompression.js';

describe('DatabaseCompression', () => {
    let compression;

    beforeEach(() => {
        compression = new DatabaseCompression();
    });

    describe('encodeKey', () => {
        test('encodes email addresses correctly', () => {
            expect(compression.encodeKey('test@example.com', 'email'))
                .toBe('email:test@example_com');
        });

        test('encodes keys with special characters', () => {
            expect(compression.encodeKey('test.key#with$special[chars]', 'test'))
                .toBe('test:test_key_with_special_chars_');
        });

        test('throws error for empty key', () => {
            expect(() => compression.encodeKey('', 'test')).toThrow('Key must be a non-empty string');
        });

        test('throws error for null key', () => {
            expect(() => compression.encodeKey(null, 'test')).toThrow('Key must be a non-empty string');
        });
    });

    describe('compress and decompress', () => {
        test('compresses and decompresses small data without compression', async () => {
            const data = { test: 'small data' };
            const compressed = await compression.compress(data);
            const decompressed = await compression.decompress(compressed);
            expect(decompressed).toEqual(data);

            // Verify it wasn't actually compressed
            const parsed = JSON.parse(compressed);
            expect(parsed.c).toBe(false);
        });

        test('compresses and decompresses large data with compression', async () => {
            // Create a large object that exceeds the compression threshold
            const largeData = {
                array: Array(100).fill('test string that will be repeated many times'),
                nested: {
                    moreData: Array(50).fill({ 
                        field1: 'more repeated data',
                        field2: 'even more data'
                    })
                }
            };

            const compressed = await compression.compress(largeData);
            const decompressed = await compression.decompress(compressed);
            
            expect(decompressed).toEqual(largeData);

            // Verify it was actually compressed
            const parsed = JSON.parse(compressed);
            expect(parsed.c).toBe(true);

            // Verify compression actually saved space
            const originalSize = JSON.stringify(largeData).length;
            const compressedSize = compressed.length;
            expect(compressedSize).toBeLessThan(originalSize);
        });

        test('handles complex nested objects', async () => {
            const complexData = {
                string: 'test',
                number: 123,
                boolean: true,
                null: null,
                array: [1, 2, 3],
                date: new Date('2023-01-01').toISOString(),
                nested: {
                    deeper: {
                        evenDeeper: {
                            value: 'deep value'
                        }
                    }
                }
            };

            const compressed = await compression.compress(complexData);
            const decompressed = await compression.decompress(compressed);
            expect(decompressed).toEqual(complexData);
        });

        test('handles empty objects and arrays', async () => {
            const data = { emptyObj: {}, emptyArray: [] };
            const compressed = await compression.compress(data);
            const decompressed = await compression.decompress(compressed);
            expect(decompressed).toEqual(data);
        });

        test('throws error for invalid compressed data', async () => {
            await expect(compression.decompress('{"invalid": "format"}')).rejects.toThrow('Invalid compressed data format');
        });

        test('throws error for null data', async () => {
            await expect(compression.decompress(null)).rejects.toThrow('Data must not be null or undefined');
        });
    });

    describe('compression threshold', () => {
        test('respects custom compression threshold', async () => {
            // Create compression with very high threshold
            const highThreshold = new DatabaseCompression(1000000);
            const mediumData = {
                array: Array(100).fill('medium sized data')
            };

            const compressed = await highThreshold.compress(mediumData);
            const parsed = JSON.parse(compressed);
            
            // Should not be compressed due to high threshold
            expect(parsed.c).toBe(false);

            // Create compression with very low threshold
            const lowThreshold = new DatabaseCompression(1);
            const smallData = { tiny: 'data' };

            const compressedSmall = await lowThreshold.compress(smallData);
            const parsedSmall = JSON.parse(compressedSmall);
            
            // Should be compressed due to low threshold
            expect(parsedSmall.c).toBe(true);
        });
    });
}); 