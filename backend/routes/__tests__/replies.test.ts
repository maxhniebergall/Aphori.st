import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import repliesRouter, { setDb as setRepliesDbAndService } from '../replies.js';
import { VectorService } from '../../services/vectorService.js';
import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { AuthenticatedRequest, User, CreateReplyRequest, Quote, PostData, ReplyData } from '../../types/index.js';
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

// Mock utility function if it's complex or has side effects (not strictly necessary if simple)
jest.mock('../../utils/quoteUtils.js', () => ({
  getQuoteKey: jest.fn((quote: Quote) => quote.sourceId === 'parentPostId123' 
    ? 'quotes:3PzabmoZkMtBqsokYkTpcQMHxQsFYL+CyeO6knBs0ag='
    : 'quotes:TDCwig5ZR7hWtt1RbXbszOjDx8UaqKEC5jsD2/ZtlUQ='),
}));

// Mock services and db client
const mockAddVectorReplies = jest.fn<VectorService['addVector']>();
const mockCreateReplyTransaction = jest.fn<LoggedDatabaseClient['createReplyTransaction']>();
const mockGetPost = jest.fn<(id: string) => Promise<PostData | null>>();
const mockGetReply = jest.fn<(id: string) => Promise<ReplyData | null>>();

const mockVectorServiceReplies = {
  addVector: mockAddVectorReplies,
} as unknown as VectorService;

const mockDbClientReplies = {
  createReplyTransaction: mockCreateReplyTransaction,
  getPost: mockGetPost,
  getReply: mockGetReply,
} as unknown as LoggedDatabaseClient;

let appReplies: Express;

beforeAll(() => {
  appReplies = express();
  appReplies.use(express.json());
  appReplies.use((req, res, next) => { 
    res.locals.requestId = 'test-request-id-replies';
    next();
  });
  setRepliesDbAndService(mockDbClientReplies, mockVectorServiceReplies);
  appReplies.use('/api/replies', repliesRouter);
});

beforeEach(() => {
  jest.clearAllMocks();
});

const MIN_REPLY_LENGTH = 50; // from replies.ts (not exported)

describe('POST /api/replies/createReply', () => {
  const validReplyRequest: CreateReplyRequest = {
    text: 'a'.repeat(MIN_REPLY_LENGTH),
    parentId: 'parentPostId123',
    quote: {
      text: 'Quoted text from parent',
      sourceId: 'parentPostId123',
      selectionRange: { start: 0, end: 10 },
    },
  };

  it('should create a reply, save to DB, and call vectorService.addVector when parent is a post', async () => {
    mockGetPost.mockResolvedValue({ id: 'parentPostId123', authorId: 'testAuthor', content: 'parent content', createdAt: 'date', replyCount: 0 }); // Corrected PostData
    mockGetReply.mockResolvedValue(null); // Parent is not a reply
    mockCreateReplyTransaction.mockResolvedValue(undefined);
    mockAddVectorReplies.mockResolvedValue(undefined);

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(validReplyRequest);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBeDefined();
    const replyId = response.body.data.id;

    expect(mockCreateReplyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: replyId,
        text: validReplyRequest.text,
        parentId: validReplyRequest.parentId,
        parentType: 'post',
        rootPostId: 'parentPostId123',
        authorId: 'dev_user',
        quote: validReplyRequest.quote,
        createdAt: expect.any(String)
      }),
      'quotes:3PzabmoZkMtBqsokYkTpcQMHxQsFYL+CyeO6knBs0ag=', // from mock getQuoteKey
      expect.objectContaining({ requestId: 'test-request-id-replies', operationId: expect.any(String) }) // logContext
    );
    expect(mockAddVectorReplies).toHaveBeenCalledWith(replyId, 'reply', validReplyRequest.text);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.objectContaining({ replyId }), 'Reply content added to vector index.');
  });

  it('should create a reply, save to DB, and call vectorService.addVector when parent is a reply', async () => {
    const parentReplyId = 'parentReplyId456';
    const rootPostIdForParentReply = 'rootPostForParentReply789';
    const requestWithReplyParent: CreateReplyRequest = {
        ...validReplyRequest,
        parentId: parentReplyId,
        quote: { ...validReplyRequest.quote, sourceId: parentReplyId }
    };
    mockGetPost.mockResolvedValue(null); // Parent is not a post
    mockGetReply.mockResolvedValue({
        id: parentReplyId, 
        authorId: 'parentReplyAuthor', 
        text: 'parent reply text', 
        parentId: 'someOtherParent', // or rootPostIdForParentReply if it's a direct child of a post
        parentType: 'post', // or 'reply' depending on actual parent structure
        quote: { text: 'quote from parent reply', sourceId: 'someOtherParent', selectionRange: {start: 0, end: 5}}, 
        createdAt: 'date',
        rootPostId: rootPostIdForParentReply 
    }); 
    mockCreateReplyTransaction.mockResolvedValue(undefined);
    mockAddVectorReplies.mockResolvedValue(undefined);

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(requestWithReplyParent);
    
    expect(response.status).toBe(201);
    const replyId = response.body.data.id;

    expect(mockCreateReplyTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
            id: replyId,
            parentId: parentReplyId,
            parentType: 'reply',
            rootPostId: rootPostIdForParentReply,
        }),
        'quotes:TDCwig5ZR7hWtt1RbXbszOjDx8UaqKEC5jsD2/ZtlUQ=', // hashedQuoteKey
        expect.objectContaining({ requestId: 'test-request-id-replies', operationId: expect.any(String) }) // logContext
    );
    expect(mockAddVectorReplies).toHaveBeenCalledWith(replyId, 'reply', requestWithReplyParent.text);
  });

  it('should still create reply successfully even if vectorService.addVector fails', async () => {
    mockGetPost.mockResolvedValue({ id: 'parentPostId123', authorId: 'testAuthor', content: 'parent content', createdAt: 'date', replyCount: 0 }); // Corrected PostData
    mockGetReply.mockResolvedValue(null);
    mockCreateReplyTransaction.mockResolvedValue(undefined);
    const vectorError = new Error('Vector add failed for reply');
    mockAddVectorReplies.mockRejectedValue(vectorError);

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(validReplyRequest);

    expect(response.status).toBe(201);
    expect(mockCreateReplyTransaction).toHaveBeenCalledTimes(1);
    expect(mockAddVectorReplies).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.objectContaining({ replyId: response.body.data.id, err: vectorError }), 'Error adding reply content to vector index.');
  });

  it('should return 404 if parent post/reply not found', async () => {
    mockGetPost.mockResolvedValue(null);
    mockGetReply.mockResolvedValue(null);

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(validReplyRequest);
    
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Parent not found');
  });

  it('should return 400 if reply text is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      text: undefined
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it('should return 400 if parentId is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      parentId: undefined
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it('should return 400 if quote is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      quote: undefined
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it('should return 400 if quote text is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      quote: { ...validReplyRequest.quote, text: undefined }
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it('should return 400 if quote sourceId is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      quote: { ...validReplyRequest.quote, sourceId: undefined }
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it('should return 400 if quote selectionRange is missing', async () => {
    const invalidRequest = {
      ...validReplyRequest,
      quote: { ...validReplyRequest.quote, selectionRange: undefined }
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required fields.');
  });

  it(`should return 400 if reply text is too short (less than ${MIN_REPLY_LENGTH} chars)`, async () => {
    const shortText = 'a'.repeat(MIN_REPLY_LENGTH - 1);
    const shortTextRequest = {
      ...validReplyRequest,
      text: shortText
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(shortTextRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Reply text below min length.');
  });

  it('should return 400 if reply text is too long (more than 1000 chars)', async () => {
    const longText = 'a'.repeat(1001);
    const longTextRequest = {
      ...validReplyRequest,
      text: longText
    };

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(longTextRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Reply text exceeds max length.');
  });

  it('should return 500 if database transaction fails', async () => {
    mockGetPost.mockResolvedValue({ id: 'parentPostId123', authorId: 'testAuthor', content: 'parent content', createdAt: 'date', replyCount: 0 });
    mockGetReply.mockResolvedValue(null);
    
    const dbError = new Error('DB transaction failed');
    mockCreateReplyTransaction.mockRejectedValue(dbError);

    const response = await request(appReplies)
      .post('/api/replies/createReply')
      .set('Authorization', 'Bearer dev_token')
      .send(validReplyRequest);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Server error creating reply');
    expect(mockAddVectorReplies).not.toHaveBeenCalled();
  });
}); 