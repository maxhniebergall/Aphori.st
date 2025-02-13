/**
 * Requirements:
 * - Test cursor-based pagination implementation
 * - Test both forward and backward pagination
 * - Test edge cases and error handling
 * - Type safety for all operations
 * - Yarn for package management
 */

import '@types/jest';
import { PaginationService } from '../pagination';
import { DatabaseClient, UnifiedNode, CursorPaginationRequest } from '../../types';

describe('PaginationService', () => {
    let paginationService: PaginationService;
    let mockDb: jest.Mocked<DatabaseClient>;

    const mockNodes: UnifiedNode[] = [
        {
            id: '1',
            type: 'story',
            content: 'Story 1',
            metadata: {
                parentId: null,
                author: 'User 1',
                authorId: 'user1',
                authorEmail: 'user1@example.com',
                createdAt: '2024-01-01T00:00:00Z',
                title: 'Story 1'
            }
        },
        {
            id: '2',
            type: 'reply',
            content: 'Reply 1',
            metadata: {
                parentId: ['1'],
                author: 'User 2',
                authorId: 'user2',
                authorEmail: 'user2@example.com',
                createdAt: '2024-01-01T00:01:00Z'
            }
        }
    ];

    beforeEach(() => {
        mockDb = {
            connect: jest.fn(),
            isConnected: jest.fn(),
            isReady: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            hSet: jest.fn(),
            hIncrBy: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            lPush: jest.fn(),
            lRange: jest.fn(),
            sAdd: jest.fn(),
            zAdd: jest.fn(),
            zRange: jest.fn(),
            zCard: jest.fn(),
            encodeKey: jest.fn(),
            compress: jest.fn(),
            decompress: jest.fn()
        };
        paginationService = new PaginationService(mockDb);
    });

    describe('getNodes', () => {
        it('should return nodes with forward pagination', async () => {
            const options: CursorPaginationRequest = {
                limit: 1,
                direction: 'forward'
            };

            const result = await paginationService.getNodes(options);

            expect(result).toHaveProperty('nodes');
            expect(result).toHaveProperty('nextCursor');
            expect(result).toHaveProperty('prevCursor');
            expect(result).toHaveProperty('hasMore');
        });

        it('should return nodes with backward pagination', async () => {
            const options: CursorPaginationRequest = {
                limit: 1,
                direction: 'backward'
            };

            const result = await paginationService.getNodes(options);

            expect(result).toHaveProperty('nodes');
            expect(result).toHaveProperty('nextCursor');
            expect(result).toHaveProperty('prevCursor');
            expect(result).toHaveProperty('hasMore');
        });

        it('should handle cursor decoding', async () => {
            const node = mockNodes[0];
            const cursor = Buffer.from(JSON.stringify({
                id: node.id,
                timestamp: new Date(node.metadata.createdAt).getTime(),
                type: node.type
            })).toString('base64');

            const options: CursorPaginationRequest = {
                cursor,
                limit: 1,
                direction: 'forward'
            };

            const result = await paginationService.getNodes(options);

            expect(result).toHaveProperty('nodes');
            expect(result).toHaveProperty('nextCursor');
            expect(result).toHaveProperty('prevCursor');
            expect(result).toHaveProperty('hasMore');
        });

        it('should handle empty results', async () => {
            const options: CursorPaginationRequest = {
                limit: 1,
                direction: 'forward'
            };

            const result = await paginationService.getNodes(options);

            expect(result.nodes).toHaveLength(0);
            expect(result.hasMore).toBe(false);
            expect(result.nextCursor).toBeUndefined();
            expect(result.prevCursor).toBeUndefined();
        });
    });
}); 