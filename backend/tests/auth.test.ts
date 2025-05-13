import jwt from 'jsonwebtoken';
import { DatabaseCompression } from '../db/DatabaseCompression.js';

// Mock database client for testing
class MockDatabaseClient {
    private store: Map<string, any>;
    public compression: DatabaseCompression;

    constructor() {
        this.store = new Map<string, any>();
        this.compression = new DatabaseCompression();
    }

    async get(key: string): Promise<any> {
        return this.store.get(key);
    }

    async set(key: string, value: any): Promise<string> {
        this.store.set(key, value);
        return 'OK';
    }

    async hGet(key: string, field: string): Promise<any> {
        const hash = this.store.get(key) || new Map<string, any>();
        return hash.get(field);
    }

    async hSet(key: string, field: string, value: any): Promise<number> {
        let hash = this.store.get(key);
        if (!hash) {
            hash = new Map<string, any>();
            this.store.set(key, hash);
        }
        hash.set(field, value);
        return 1;
    }

    encodeKey(key: string, prefix: string): string {
        return `${prefix}:${key}`;
    }
}

describe('Authentication Flow', () => {
    let db: MockDatabaseClient;
    const MAGIC_LINK_SECRET = 'test_magic_link_secret';
    const AUTH_TOKEN_SECRET = 'test_auth_token_secret';
    const testUser = {
        id: 'testuser',
        email: 'test@example.com',
        createdAt: new Date().toISOString()
    };

    beforeEach(async () => {
        process.env.MAGIC_LINK_SECRET = MAGIC_LINK_SECRET;
        process.env.AUTH_TOKEN_SECRET = AUTH_TOKEN_SECRET;
        
        db = new MockDatabaseClient();
        
        const compressed = await db.compression.compress(testUser);
        await db.hSet(db.encodeKey(testUser.id, 'user'), 'data', compressed);
        await db.set(db.encodeKey(testUser.email, 'email_to_id'), testUser.id);
    });

    describe('Magic Link Verification', () => {
        test('should verify valid magic link token', async () => {
            const token = jwt.sign(
                { email: testUser.email },
                MAGIC_LINK_SECRET,
                { expiresIn: '15m' }
            );

            const decoded = jwt.verify(token, MAGIC_LINK_SECRET) as jwt.JwtPayload;
            expect(decoded.email).toBe(testUser.email);

            const userId = await db.get(db.encodeKey(decoded.email!, 'email_to_id'));
            expect(userId).toBe(testUser.id);

            const userData = await db.hGet(db.encodeKey(userId, 'user'), 'data');
            const user = await db.compression.decompress(userData);
            expect(user.email).toBe(testUser.email);
        });

        test('should reject expired token', async () => {
            const token = jwt.sign(
                { email: testUser.email },
                MAGIC_LINK_SECRET,
                { expiresIn: '0s' } 
            );

            await new Promise(resolve => setTimeout(resolve, 1000));

            expect(() => {
                jwt.verify(token, MAGIC_LINK_SECRET);
            }).toThrow('jwt expired');
        });

        test('should reject token with wrong signature', async () => {
            const token = jwt.sign(
                { email: testUser.email },
                'wrong_secret',
                { expiresIn: '15m' }
            );

            expect(() => {
                jwt.verify(token, MAGIC_LINK_SECRET);
            }).toThrow('invalid signature');
        });

        test('should reject token for non-existent user', async () => {
            const token = jwt.sign(
                { email: 'nonexistent@example.com' },
                MAGIC_LINK_SECRET,
                { expiresIn: '15m' }
            );

            const decoded = jwt.verify(token, MAGIC_LINK_SECRET) as jwt.JwtPayload;
            const userId = await db.get(db.encodeKey(decoded.email!, 'email_to_id'));
            expect(userId).toBeUndefined();
        });
    });
}); 