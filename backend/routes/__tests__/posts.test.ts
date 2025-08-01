import request from 'supertest';
import express, { Express } from 'express';
import postsRouter, { setDb as setPostsDbAndService, MAX_POST_LENGTH } from '../posts.js'; 
import { VectorService } from '../../services/vectorService.js';
import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { AuthenticatedRequest, User } from '../../types/index.js';
import { jest } from '@jest/globals';
import logger from '../../logger.js';

// Create function spies for logger methods
const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});
const mockLoggerWarn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
const mockLoggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
const mockLoggerDebug = jest.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock middleware
jest.mock('../../middleware/authMiddleware.js', () => ({
  authenticateToken: (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'dev_user', email: 'test@example.com' } as User; // Match the actual user ID used
    next();
  },
}));

// Mock services and db client
const mockAddVector = jest.fn<() => Promise<void>>();
const mockCreatePostTransaction = jest.fn<() => Promise<void>>();

const mockVectorService = {
  addVector: mockAddVector,
} as unknown as VectorService;

const mockDbClient = {
  createPostTransaction: mockCreatePostTransaction,
} as unknown as LoggedDatabaseClient;

// Define a constant for min post length mirroring the unexported one in posts.ts
const TEST_MIN_POST_LENGTH = 100;

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  setPostsDbAndService(mockDbClient, mockVectorService); // Inject mocks into posts router
  app.use('/api/posts', postsRouter);
  app.use((req, res, next) => { // Basic requestId middleware for logging context in route
    res.locals.requestId = 'test-request-id';
    next();
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/posts/createPost', () => {
  const validPostContent = 'a'.repeat(TEST_MIN_POST_LENGTH);
  const postTree = { content: validPostContent };

  it('should create a post, save to DB, and call vectorService.addVector on success', async () => {
    mockCreatePostTransaction.mockResolvedValue(undefined); // Simulate successful DB transaction
    mockAddVector.mockResolvedValue(undefined); // Simulate successful vector add

    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    const postId = response.body.id;

    expect(mockCreatePostTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: postId,
        content: validPostContent,
        authorId: 'dev_user',
        replyCount: 0,
      }),
      expect.objectContaining({
        id: postId,
        authorId: 'dev_user',
        textSnippet: validPostContent.substring(0, 100),
      })
    );
    expect(mockAddVector).toHaveBeenCalledWith(postId, 'post', validPostContent);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.objectContaining({ postId }), 'Post content added to vector index.');
  });

  it('should still create post successfully even if vectorService.addVector fails (fire and forget)', async () => {
    mockCreatePostTransaction.mockResolvedValue(undefined);
    const vectorError = new Error('Vector add failed');
    mockAddVector.mockRejectedValue(vectorError); // Simulate vector add failure

    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    const postId = response.body.id;

    expect(mockCreatePostTransaction).toHaveBeenCalledTimes(1);
    expect(mockAddVector).toHaveBeenCalledWith(postId, 'post', validPostContent);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.objectContaining({ postId, err: vectorError }), 'Error adding post content to vector index.');
  });

  it('should return 400 if post content is missing', async () => {
    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree: {} });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Post content is required');
  });

  it(`should return 400 if post content is too short (less than ${TEST_MIN_POST_LENGTH} chars)`, async () => {
    const shortContent = 'a'.repeat(TEST_MIN_POST_LENGTH - 1);
    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree: { content: shortContent } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe(`Post content must be at least ${TEST_MIN_POST_LENGTH} characters long.`);
  });

  it(`should return 400 if post content is too long (more than ${MAX_POST_LENGTH} chars)`, async () => {
    const longContent = 'a'.repeat(MAX_POST_LENGTH + 1);
    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree: { content: longContent } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe(`Post content exceeds the maximum length of ${MAX_POST_LENGTH} characters.`);
  });

  it('should return 500 if database transaction fails', async () => {
    const dbError = new Error('DB transaction failed');
    mockCreatePostTransaction.mockRejectedValue(dbError);

    const response = await request(app)
      .post('/api/posts/createPost')
      .set('Authorization', 'Bearer dev_token')
      .send({ postTree });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Server error creating post');
    expect(mockAddVector).not.toHaveBeenCalled(); // Should not be called if DB fails
  });
}); 