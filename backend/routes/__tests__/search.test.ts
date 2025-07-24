import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import searchRouter, { setDbAndVectorService } from '../search.js'; // Adjust path as needed
import { VectorService } from '../../services/vectorService.js';
import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { PostData, ReplyData, VectorSearchResponse } from '../../types/index.js';
import logger from '../../logger.js';

// Create function spies for logger methods
const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});
const mockLoggerWarn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
const mockLoggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
const mockLoggerDebug = jest.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock services and db client
const mockSearchVectors = jest.fn<VectorService['searchVectors']>();
const mockGetPost = jest.fn<(id: string) => Promise<PostData | null>>();
const mockGetReply = jest.fn<(id: string) => Promise<ReplyData | null>>();

const mockVectorService = {
  searchVectors: mockSearchVectors,
  // Add other VectorService methods if needed by other routes, or ensure they are not called
} as unknown as VectorService; // Cast to satisfy type, knowing we only use searchVectors here

const mockDbClient = {
  getPost: mockGetPost,
  getReply: mockGetReply,
  // Add other LoggedDatabaseClient methods if necessary
} as unknown as LoggedDatabaseClient;

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  // Inject mock dependencies into the router
  setDbAndVectorService(mockDbClient, mockVectorService);
  app.use('/api/search', searchRouter);
  // Middleware to add requestId for logger (if your actual app does this)
  app.use((req, res, next) => {
    res.locals.requestId = 'test-request-id';
    next();
  });
});

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();
});

const K_NEIGHBORS_IN_ROUTE = 10; // As defined in search.ts

describe('GET /api/search/vector', () => {
  it('should return 400 if query parameter is missing or empty', async () => {
    let response = await request(app).get('/api/search/vector');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, results: [], error: 'Missing or invalid query parameter.' });

    response = await request(app).get('/api/search/vector?query=');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, results: [], error: 'Missing or invalid query parameter.' });

    response = await request(app).get('/api/search/vector?query=   ');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, results: [], error: 'Missing or invalid query parameter.' });
  });

  it('should call vectorService.searchVectors and return empty results if service returns none', async () => {
    const query = 'testquery';
    mockSearchVectors.mockResolvedValue([]);

    const response = await request(app).get(`/api/search/vector?query=${query}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, results: [] });
    expect(mockSearchVectors).toHaveBeenCalledWith(query, K_NEIGHBORS_IN_ROUTE);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.objectContaining({ query }), 'Vector search returned no results.');
  });

  it('should fetch data from DB for each search result and format response', async () => {
    const query = 'findme';
    const searchResultsFromService: { id: string, type: 'post' | 'reply', score: number }[] = [
      { id: 'post1', type: 'post', score: 0.9 },
      { id: 'reply1', type: 'reply', score: 0.8 },
    ];
    const post1Data: PostData = { id: 'post1', authorId: 'user1', content: 'content1', createdAt: 'date1', replyCount: 0 };
    const reply1Data: ReplyData = { id: 'reply1', authorId: 'user2', text: 'text1', parentId: 'post1', rootPostId: 'post1', quote: {} as any, createdAt: 'date2', parentType: 'post' };

    mockSearchVectors.mockResolvedValue(searchResultsFromService);
    mockGetPost.mockImplementation(async (id) => (id === 'post1' ? post1Data : null));
    mockGetReply.mockImplementation(async (id) => (id === 'reply1' ? reply1Data : null));

    const response = await request(app).get(`/api/search/vector?query=${query}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.results).toEqual([
      { id: 'post1', type: 'post', score: 0.9, data: post1Data },
      { id: 'reply1', type: 'reply', score: 0.8, data: reply1Data },
    ]);
    expect(mockSearchVectors).toHaveBeenCalledWith(query, K_NEIGHBORS_IN_ROUTE);
    expect(mockGetPost).toHaveBeenCalledWith('post1');
    expect(mockGetReply).toHaveBeenCalledWith('reply1');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('should handle cases where DB fetch returns null for a search result ID', async () => {
    const query = 'findpartial';
    const searchResultsFromService: { id: string, type: 'post' | 'reply', score: number }[] = [
      { id: 'post1', type: 'post', score: 0.9 },
      { id: 'replyNonExistent', type: 'reply', score: 0.7 },
    ];
    const post1Data: PostData = { id: 'post1', authorId: 'user1', content: 'content1', createdAt: 'date1', replyCount: 0 };

    mockSearchVectors.mockResolvedValue(searchResultsFromService);
    mockGetPost.mockResolvedValue(post1Data);
    mockGetReply.mockResolvedValue(null); // replyNonExistent not found in DB

    const response = await request(app).get(`/api/search/vector?query=${query}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.results).toEqual([
      { id: 'post1', type: 'post', score: 0.9, data: post1Data },
      // replyNonExistent should be filtered out
    ]);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'replyNonExistent', contentType: 'reply' }), 
      'Content data not found for vector search result ID.'
    );
  });

  it('should return 500 if vectorService.searchVectors throws an error', async () => {
    const query = 'errorquery';
    const serviceError = new Error('VectorService error');
    mockSearchVectors.mockRejectedValue(serviceError);

    const response = await request(app).get(`/api/search/vector?query=${query}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, results: [], error: 'Internal server error during vector search.' });
    expect(mockLoggerError).toHaveBeenCalledWith(expect.objectContaining({ query, err: serviceError }), 'Error performing vector search');
  });

  // Corrected test for when an individual DB fetch fails
  it('should filter out items if a db method throws an error during individual data fetching and log appropriately', async () => {
    const query = 'dbItemErrorQuery';
    const searchResultsFromService: { id: string, type: 'post' | 'reply', score: number }[] = [
      { id: 'post1Error', type: 'post', score: 0.9 },
      { id: 'post2Success', type: 'post', score: 0.8 },
      { id: 'reply1Success', type: 'reply', score: 0.7 },
    ];
    const post2Data: PostData = { id: 'post2Success', authorId: 'user2', content: 'content2', createdAt: 'date2', replyCount: 0 };
    const reply1Data: ReplyData = { id: 'reply1Success', authorId: 'user3', text: 'replyText', parentId:'post2Success', rootPostId: 'post2Success', quote: {} as any, createdAt: 'date3', parentType: 'post'};
    const dbErrorForPost1 = new Error('DB error for post1Error');

    mockSearchVectors.mockResolvedValue(searchResultsFromService);
    mockGetPost.mockImplementation(async (id) => {
      if (id === 'post1Error') throw dbErrorForPost1;
      if (id === 'post2Success') return post2Data;
      return null;
    });
    mockGetReply.mockImplementation(async (id) => {
      if (id === 'reply1Success') return reply1Data;
      return null;
    });

    const response = await request(app).get(`/api/search/vector?query=${query}`);

    expect(response.status).toBe(200); // Route should still return 200
    expect(response.body.success).toBe(true);
    expect(response.body.results).toEqual([ // post1Error should be filtered out
      { id: 'post2Success', type: 'post', score: 0.8, data: post2Data },
      { id: 'reply1Success', type: 'reply', score: 0.7, data: reply1Data },
    ]);
    
    // Check that the error for post1Error was logged by the route's internal catch
    expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
            contentId: 'post1Error',
            contentType: 'post',
            err: dbErrorForPost1,
            query: query,
            // Don't check requestId since it seems to be undefined in the test environment
        }),
        "Error fetching content data for vector search result."
    );
  });

});

// TODO: Add tests for POST /api/posts/createPost and POST /api/replies/createReply if they involve VectorService.addVector 