import { test, expect } from '@playwright/test';
import { apiEndpoints, testUsers, testPosts, testReplies } from './fixtures/test-data';

test.describe('Duplicate Detection API', () => {
  let authToken: string;
  let postId: string;
  let originalReplyId: string;

  test.beforeEach(async ({ request }) => {
    // Mock authentication for API testing
    // In a real scenario, you'd get a proper auth token
    authToken = 'mock-auth-token';
    
    // Create a test post via API
    const postResponse = await request.post(apiEndpoints.posts.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        content: testPosts.original.content
      }
    });
    
    expect(postResponse.ok()).toBeTruthy();
    const postData = await postResponse.json();
    postId = postData.id;
    
    // Create an original reply
    const replyResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate1.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate1.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate1.quote.selectionRange
        }
      }
    });
    
    expect(replyResponse.ok()).toBeTruthy();
    const replyData = await replyResponse.json();
    originalReplyId = replyData.id;
  });

  test('should detect duplicate via API and return duplicate group', async ({ request }) => {
    // Create a duplicate reply via API
    const duplicateResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate2.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate2.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate2.quote.selectionRange
        }
      }
    });
    
    // Should return duplicate detection result
    expect(duplicateResponse.ok()).toBeTruthy();
    const responseData = await duplicateResponse.json();
    
    // Check if response indicates duplicate was detected
    expect(responseData).toHaveProperty('isDuplicate', true);
    expect(responseData).toHaveProperty('duplicateGroupId');
    expect(responseData.duplicateGroupId).toBeTruthy();
  });

  test('should fetch duplicate group data via API', async ({ request }) => {
    // First create a duplicate to get a group ID
    const duplicateResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate2.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate2.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate2.quote.selectionRange
        }
      }
    });
    
    const duplicateData = await duplicateResponse.json();
    const groupId = duplicateData.duplicateGroupId;
    
    // Fetch duplicate group via API
    const groupResponse = await request.get(apiEndpoints.replies.duplicate(groupId), {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(groupResponse.ok()).toBeTruthy();
    const groupData = await groupResponse.json();
    
    // Verify response structure
    expect(groupData).toHaveProperty('success', true);
    expect(groupData).toHaveProperty('data');
    expect(groupData.data).toHaveProperty('group');
    expect(groupData.data).toHaveProperty('originalReply');
    expect(groupData.data).toHaveProperty('duplicates');
    
    // Verify group data
    const group = groupData.data.group;
    expect(group).toHaveProperty('id', groupId);
    expect(group).toHaveProperty('originalReplyId', originalReplyId);
    expect(group).toHaveProperty('duplicateIds');
    expect(group.duplicateIds).toHaveLength(1);
    expect(group).toHaveProperty('threshold', 0.08);
    
    // Verify original reply data
    const originalReply = groupData.data.originalReply;
    expect(originalReply).toHaveProperty('id', originalReplyId);
    expect(originalReply).toHaveProperty('text', testReplies.duplicate1.text);
    
    // Verify duplicate reply data
    const duplicates = groupData.data.duplicates;
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toHaveProperty('text', testReplies.duplicate2.text);
    expect(duplicates[0]).toHaveProperty('duplicateGroupId', groupId);
    expect(duplicates[0]).toHaveProperty('originalReplyId', originalReplyId);
    expect(duplicates[0]).toHaveProperty('similarityScore');
    expect(duplicates[0]).toHaveProperty('votes');
  });

  test('should handle voting via API', async ({ request }) => {
    // Create duplicate group
    const duplicateResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate2.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate2.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate2.quote.selectionRange
        }
      }
    });
    
    const duplicateData = await duplicateResponse.json();
    const groupId = duplicateData.duplicateGroupId;
    const duplicateReplyId = duplicateData.id;
    
    // Vote for the duplicate reply
    const voteResponse = await request.post(apiEndpoints.replies.vote(groupId), {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        replyId: duplicateReplyId
      }
    });
    
    expect(voteResponse.ok()).toBeTruthy();
    const voteData = await voteResponse.json();
    expect(voteData).toHaveProperty('success', true);
    
    // Fetch updated group data to verify vote was recorded
    const updatedGroupResponse = await request.get(apiEndpoints.replies.duplicate(groupId), {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    const updatedGroupData = await updatedGroupResponse.json();
    const duplicateReply = updatedGroupData.data.duplicates[0];
    
    // Verify vote was recorded
    expect(duplicateReply.votes.upvotes.length + duplicateReply.votes.downvotes.length).toBeGreaterThan(0);
    expect(duplicateReply.votes.totalScore).toBeGreaterThanOrEqual(0);
  });

  test('should return 404 for non-existent duplicate group', async ({ request }) => {
    const nonExistentGroupId = 'non-existent-group-id';
    
    const response = await request.get(apiEndpoints.replies.duplicate(nonExistentGroupId), {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(response.status()).toBe(404);
    const responseData = await response.json();
    expect(responseData).toHaveProperty('success', false);
    expect(responseData).toHaveProperty('error');
  });

  test('should handle unauthorized requests', async ({ request }) => {
    // Try to vote without authentication
    const voteResponse = await request.post(apiEndpoints.replies.vote('some-group-id'), {
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        replyId: 'some-reply-id'
      }
    });
    
    expect(voteResponse.status()).toBe(401);
  });

  test('should validate vector similarity threshold', async ({ request }) => {
    // Create a unique reply that should NOT be detected as duplicate
    const uniqueResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.unique1.text,
        parentId: postId,
        quote: {
          text: testReplies.unique1.quote.text,
          sourceId: postId,
          selectionRange: testReplies.unique1.quote.selectionRange
        }
      }
    });
    
    expect(uniqueResponse.ok()).toBeTruthy();
    const responseData = await uniqueResponse.json();
    
    // Should not be detected as duplicate
    expect(responseData).toHaveProperty('isDuplicate', false);
    expect(responseData).not.toHaveProperty('duplicateGroupId');
  });

  test('should handle multiple duplicates in same group', async ({ request }) => {
    // Create first duplicate
    const firstDuplicateResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate2.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate2.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate2.quote.selectionRange
        }
      }
    });
    
    const firstDuplicateData = await firstDuplicateResponse.json();
    const groupId = firstDuplicateData.duplicateGroupId;
    
    // Create second duplicate - should be added to same group
    const secondDuplicateResponse = await request.post(apiEndpoints.replies.create, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        text: testReplies.duplicate3.text,
        parentId: postId,
        quote: {
          text: testReplies.duplicate3.quote.text,
          sourceId: postId,
          selectionRange: testReplies.duplicate3.quote.selectionRange
        }
      }
    });
    
    const secondDuplicateData = await secondDuplicateResponse.json();
    
    // Should be added to the same group
    expect(secondDuplicateData.duplicateGroupId).toBe(groupId);
    
    // Fetch group data to verify both duplicates are present
    const groupResponse = await request.get(apiEndpoints.replies.duplicate(groupId), {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    const groupData = await groupResponse.json();
    expect(groupData.data.duplicates).toHaveLength(2);
    expect(groupData.data.group.duplicateIds).toHaveLength(2);
  });
});