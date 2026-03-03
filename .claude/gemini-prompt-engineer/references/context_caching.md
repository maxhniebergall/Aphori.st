# Gemini Context Caching

Reference: https://ai.google.dev/gemini-api/docs/caching

## Overview

Context caching stores a chunk of input tokens once and reuses them across many requests at a significant discount. Two mechanisms exist:

| | Implicit | Explicit |
|---|---|---|
| Setup | None (automatic) | Create cache, pass ID |
| Savings | 75–90% on cached tokens | Same discount |
| Guarantee | Cache hit not guaranteed | Guaranteed for TTL duration |
| Best for | Repeated similar requests | Large stable contexts |

## Implicit Caching

Enabled by default on Gemini 2.5+ models. No code changes required. The API automatically detects shared prefixes with previous requests and applies the discount.

**Key principle**: Structure prompts with static content first, dynamic content last:

```
[System instructions]          ← static, gets cached
[Large document / reference]   ← static, gets cached
---
[User query]                   ← dynamic, appended per request
```

Monitor savings via `usageMetadata.cachedContentTokenCount`.

## Explicit Caching

### When to use

- System prompts > 1K tokens reused across many requests
- Same document/video analyzed with different questions
- Chatbot with large stable context (FAQs, manuals, codebases)
- Need predictable, guaranteed cost reduction

### Minimum token thresholds

| Model | Min Tokens |
|-------|------------|
| `gemini-2.5-flash` | 1,024 |
| `gemini-2.5-pro` | 4,096 |
| `gemini-3-flash-preview` | 1,024 |
| `gemini-3.1-pro-preview` | 4,096 |

### TypeScript/JavaScript Example

```typescript
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Upload large content (once)
const doc = await ai.files.upload({
  file: "path/to/large-document.txt",
  config: { mimeType: "text/plain" },
});

// 2. Create cache (once, reuse for TTL duration)
const cache = await ai.caches.create({
  model: "gemini-2.5-flash",
  config: {
    contents: createUserContent(createPartFromUri(doc.uri, doc.mimeType)),
    systemInstruction: "You are an expert analyst. Answer questions about the document.",
    ttl: "3600s", // 1 hour (default). Billing: $1.00/1M tokens/hr
  },
});

// 3. Reference cache in requests (many times)
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "What are the key risks identified in this document?",
  config: { cachedContent: cache.name },
});

console.log(response.text);
console.log("Cached tokens:", response.usageMetadata?.cachedContentTokenCount);
```

### Managing Caches

```typescript
// List caches
const caches = await ai.caches.list();

// Update TTL (only supported modification)
await ai.caches.update(cache.name, { config: { ttl: "7200s" } });

// Delete cache (stop billing storage)
await ai.caches.delete(cache.name);
```

### Old SDK (GoogleGenerativeAI)

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);

const cache = await cacheManager.create({
  model: "models/gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: largeDocument }] }],
  systemInstruction: "You are an expert...",
  ttlSeconds: 3600,
});

const model = genAI.getGenerativeModelFromCachedContent(cache);
const result = await model.generateContent("Your question here");
```

## Cost Model

**Cached tokens**: billed at 75–90% discount vs standard input rate
- Gemini 2.5+: 90% discount
- Gemini 2.0: 75% discount

**Storage**: $1.00 per 1M tokens per hour (TTL duration)

**Break-even**: Explicit caching pays off when you reuse the cache enough times that discount savings exceed storage cost. Rule of thumb: beneficial if you make 5+ requests to the same cached content within the TTL.

## Prompting Strategies for Cache Efficiency

### Put stable content first

```typescript
// ✅ Cache-friendly: stable prefix, variable suffix
const systemInstruction = `
You are an expert on our product documentation.
Always cite the specific section when answering.
`;

const cachedContent = fullProductDocs; // large, static
const userQuery = userQuestion;        // small, dynamic
```

### Avoid modifying the prefix between requests

```typescript
// ❌ Cache miss: dynamic timestamp in the static section
const prompt = `Current time: ${Date.now()}\n\n${largeDocument}\n\nQuestion: ${question}`;

// ✅ Cache hit: timestamp only in the query section
const prompt = `${largeDocument}\n\nQuestion (asked at ${Date.now()}): ${question}`;
```

## Limitations

- Cache content cannot be read/retrieved after creation (opaque)
- Only TTL can be updated; content cannot be modified
- Cached tokens count toward rate limits
- Free tier does not support explicit caching
