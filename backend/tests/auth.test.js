import jwt from 'jsonwebtoken';
import { DatabaseCompression } from '../db/DatabaseCompression.js';

// Mock database client for testing
class MockDatabaseClient {
    constructor() {
        this.store = new Map();
        this.compression = new DatabaseCompression();
    }

    async get(key) {
        return this.store.get(key);
    }

    async set(key, value) {
        this.store.set(key, value);
        return 'OK';
    }

    async hGet(key, field) {
        const hash = this.store.get(key) || new Map();
        return hash.get(field);
    }

    async hSet(key, field, value) {
        let hash = this.store.get(key);
        if (!hash) {
            hash = new Map();
            this.store.set(key, hash);
        }
        hash.set(field, value);
        return 1;
    }

    encodeKey(key, prefix) {
        return this.compression.encodeKey(key, prefix);
    }
}

describe('Authentication Flow', () => {
    let db;
    const MAGIC_LINK_SECRET = 'test_magic_link_secret';
    const AUTH_TOKEN_SECRET = 'test_auth_token_secret';
    const testUser = {
        id: 'testuser',
        email: 'test@example.com',
        createdAt: new Date().toISOString()
    };

    beforeEach(async () => {
        // Set up test environment
        process.env.MAGIC_LINK_SECRET = MAGIC_LINK_SECRET;
        process.env.AUTH_TOKEN_SECRET = AUTH_TOKEN_SECRET;
        
        // Initialize mock database
        db = new MockDatabaseClient();
        
        // Store test user in database
        const compressed = await db.compression.compress(testUser);
        await db.hSet(db.encodeKey(testUser.id, 'user'), 'data', compressed);
        await db.set(db.encodeKey(testUser.email, 'email_to_id'), testUser.id);
    });

    describe('Magic Link Verification', () => {
        test('should verify valid magic link token', async () => {
            // Generate a valid magic link token
            const token = jwt.sign(
                { email: testUser.email },
                MAGIC_LINK_SECRET,
                { expiresIn: '15m' }
            );

            // Decode and verify the token
            const decoded = jwt.verify(token, MAGIC_LINK_SECRET);
            expect(decoded.email).toBe(testUser.email);

            // Get user from database using email
            const userId = await db.get(db.encodeKey(decoded.email, 'email_to_id'));
            expect(userId).toBe(testUser.id);

            const userData = await db.hGet(db.encodeKey(userId, 'user'), 'data');
            const user = await db.compression.decompress(userData);
            expect(user.email).toBe(testUser.email);
        });

        test('should reject expired token', async () => {
            // Generate an expired token
            const token = jwt.sign(
                { email: testUser.email },
                MAGIC_LINK_SECRET,
                { expiresIn: '0s' } // Expire immediately
            );

            // Wait a moment to ensure token is expired
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify token throws error
            expect(() => {
                jwt.verify(token, MAGIC_LINK_SECRET);
            }).toThrow('jwt expired');
        });

        test('should reject token with wrong signature', async () => {
            // Generate token with wrong secret
            const token = jwt.sign(
                { email: testUser.email },
                'wrong_secret',
                { expiresIn: '15m' }
            );

            // Verify token throws error
            expect(() => {
                jwt.verify(token, MAGIC_LINK_SECRET);
            }).toThrow('invalid signature');
        });

        test('should reject token for non-existent user', async () => {
            // Generate token for non-existent user
            const token = jwt.sign(
                { email: 'nonexistent@example.com' },
                MAGIC_LINK_SECRET,
                { expiresIn: '15m' }
            );

            const decoded = jwt.verify(token, MAGIC_LINK_SECRET);
            const userId = await db.get(db.encodeKey(decoded.email, 'email_to_id'));
            expect(userId).toBeUndefined();
        });
    });
}); 