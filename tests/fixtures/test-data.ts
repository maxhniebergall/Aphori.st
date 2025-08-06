export const testUsers = {
  user1: {
    email: 'test-user-1@example.com',
    userId: 'test-user-1',
  },
  user2: {
    email: 'test-user-2@example.com', 
    userId: 'test-user-2',
  },
  user3: {
    email: 'test-user-3@example.com',
    userId: 'test-user-3',
  }
};

export const testPosts = {
  original: {
    content: 'This is a test post about the nature of artificial intelligence and its implications for society. We need to consider both the benefits and potential risks as AI becomes more prevalent in our daily lives.',
  },
  secondary: {
    content: 'Another interesting post about technology trends and their impact on human behavior.',
  }
};

export const testReplies = {
  // These replies should be detected as duplicates (high similarity)
  duplicate1: {
    text: 'I completely agree with your point about AI safety. The potential risks of advanced AI systems need to be carefully considered and mitigated.',
    quote: {
      text: 'We need to consider both the benefits and potential risks',
      selectionRange: { start: 95, end: 145 }
    }
  },
  duplicate2: {
    text: 'Totally agree on AI safety concerns. The risks from advanced artificial intelligence systems require careful consideration and risk mitigation strategies.',
    quote: {
      text: 'We need to consider both the benefits and potential risks',
      selectionRange: { start: 95, end: 145 }
    }
  },
  duplicate3: {
    text: 'Yes, I share your concerns about AI safety. Advanced AI poses significant risks that must be thoughtfully addressed and mitigated.',
    quote: {
      text: 'We need to consider both the benefits and potential risks',
      selectionRange: { start: 95, end: 145 }
    }
  },
  // These should NOT be detected as duplicates (low similarity)
  unique1: {
    text: 'I disagree entirely. AI will bring unprecedented benefits to humanity and revolutionize healthcare, education, and scientific discovery.',
    quote: {
      text: 'implications for society',
      selectionRange: { start: 65, end: 87 }
    }
  },
  unique2: {
    text: 'What about the economic implications? AI could lead to massive job displacement across multiple industries.',
    quote: {
      text: 'AI becomes more prevalent in our daily lives',
      selectionRange: { start: 165, end: 205 }
    }
  }
};

export const apiEndpoints = {
  base: 'http://localhost:5050/api',
  auth: {
    requestMagicLink: '/auth/request-magic-link',
    verifyMagicLink: '/auth/verify-magic-link',
    me: '/auth/me'
  },
  posts: {
    create: '/posts/createPost',
    get: (id: string) => `/posts/${id}`,
    feed: '/feed'
  },
  replies: {
    create: '/replies/createReply',
    get: (id: string) => `/replies/${id}`,
    duplicate: (groupId: string) => `/replies/duplicate/${groupId}`,
    vote: (groupId: string) => `/replies/duplicate/${groupId}/vote`
  }
};

export const duplicateThreshold = 0.08; // From DuplicateDetectionService