# Gemini API Reference - Structured Output

## Official Documentation

- **Models**: https://ai.google.dev/gemini-api/docs/models
- **Structured Output Guide**: https://ai.google.dev/gemini-api/docs/structured-output
- **Prompt Design Strategies**: https://ai.google.dev/gemini-api/docs/prompting-strategies
- **Context Caching**: https://ai.google.dev/gemini-api/docs/caching
- **Pricing**: https://ai.google.dev/gemini-api/docs/pricing

## Current Models (as of 2026)

| Model ID | Use Case | Input ($/1M) | Output ($/1M) | Speed (tok/s) |
|----------|----------|--------------|---------------|---------------|
| `gemini-3.1-flash-lite` | Best price-performance overall | $0.25 | $1.50 | 363 |
| `gemini-2.5-flash` | Strong reasoning, 1M context window | $0.30 | $2.50 | 249 |
| `gemini-2.5-flash-lite` | Cheapest, fastest for simple tasks | $0.10 | $0.40 | 366 |
| `gemini-2.5-pro` | Complex reasoning, highest quality | varies | varies | — |
| `gemini-3.1-pro-preview` | State-of-the-art, agentic/coding | $2.00–4.00 | $12.00–18.00 | — |

Source: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/

**Caching discounts**: 75% on Gemini 2.0/2.5; 90% on Gemini 2.5+ (implicit). Storage: $1.00/1M tokens/hr.

**Batch API**: 50% discount on standard rates for non-real-time workloads.

## Structured Output Configuration

### Basic Setup (TypeScript/JavaScript)

```typescript
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    fieldName: {
      type: SchemaType.STRING,
      description: "Description of the field"
    }
  },
  required: ["fieldName"]
};

const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: schema
  }
});

const responseText = result.response.text();
const data = JSON.parse(responseText);
```

## Schema Types (OpenAPI 3.0)

### Primitive Types

**STRING**
```typescript
{
  type: SchemaType.STRING,
  description: "Description",
  enum: ["option1", "option2"], // Optional: restrict to specific values
  format: "email" // Optional: email, uri, date-time, etc.
}
```

**NUMBER / INTEGER**
```typescript
{
  type: SchemaType.NUMBER, // or SchemaType.INTEGER
  description: "Numeric value",
  minimum: 0, // Optional
  maximum: 100, // Optional
  multipleOf: 0.01 // Optional: for precision
}
```

**BOOLEAN**
```typescript
{
  type: SchemaType.BOOLEAN,
  description: "True or false value"
}
```

### Complex Types

**ARRAY**
```typescript
{
  type: SchemaType.ARRAY,
  description: "List of items",
  items: {
    type: SchemaType.STRING // or any other schema
  },
  minItems: 1, // Optional
  maxItems: 10 // Optional
}
```

**OBJECT**
```typescript
{
  type: SchemaType.OBJECT,
  description: "Nested object",
  properties: {
    nestedField1: { type: SchemaType.STRING },
    nestedField2: { type: SchemaType.NUMBER }
  },
  required: ["nestedField1"], // Optional
  propertyOrdering: ["nestedField1", "nestedField2"] // Optional: ensures consistent order
}
```

## Generation Config Parameters

### responseMimeType

**JSON Mode (Recommended for Structured Data)**
```typescript
responseMimeType: 'application/json'
```

**Enum Mode (For Simple Selection)**
```typescript
responseMimeType: 'text/x.enum'
```

### temperature

Controls randomness/creativity:
- `0`: Fully deterministic (same input → same output)
- `0.3-0.5`: Slightly varied but mostly consistent
- `0.7-0.9`: Creative and diverse
- `1.0+`: Highly random

**Best Practice**: Use `temperature: 0` for data extraction tasks

### maxOutputTokens

Maximum number of tokens in response:
```typescript
maxOutputTokens: 2048 // Adjust based on expected output size
```

### topK

Limits sampling to top K tokens:
```typescript
topK: 40 // Lower = more focused, higher = more diverse
```

### topP (Nucleus Sampling)

Cumulative probability threshold:
```typescript
topP: 0.95 // Samples from smallest set of tokens with cumulative prob >= topP
```

## Response Handling

### Extracting JSON

```typescript
const result = await model.generateContent({ /* ... */ });
const responseText = result.response.text();

// Clean markdown wrapper if present (sometimes Gemini adds ```json ... ```)
const cleanedText = responseText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');

const data = JSON.parse(cleanedText);
```

### Usage Metadata

```typescript
const usageMetadata = result.response.usageMetadata;

console.log({
  promptTokenCount: usageMetadata.promptTokenCount,
  candidatesTokenCount: usageMetadata.candidatesTokenCount,
  totalTokenCount: usageMetadata.totalTokenCount,
  cachedContentTokenCount: usageMetadata.cachedContentTokenCount, // implicit or explicit cache hits
  thoughtsTokenCount: usageMetadata.thoughtsTokenCount,           // thinking models only
});
```

### Cost Calculation

**Token Rates for multimodal input**:
- Audio: 32 tokens/second
- Video: 263 tokens/second

**Gemini 2.5 Flash-Lite pricing (per 1M tokens)**:
- Text/Image/Video Input: $0.10
- Output (including thinking): $0.40

```typescript
const AUDIO_TOKENS_PER_SECOND = 32;
const VIDEO_TOKENS_PER_SECOND = 263;

// Example: 2.5 Flash-Lite
const PRICE_INPUT = 0.10;  // per 1M tokens
const PRICE_OUTPUT = 0.40; // per 1M tokens
// Cached tokens billed at 75-90% discount

const inputCost = (usageMetadata.promptTokenCount / 1_000_000) * PRICE_INPUT;
const cachedCost = (usageMetadata.cachedContentTokenCount / 1_000_000) * PRICE_INPUT * 0.10; // 90% off
const outputCost = (usageMetadata.candidatesTokenCount / 1_000_000) * PRICE_OUTPUT;
const totalCost = inputCost + cachedCost + outputCost;
```

## Multimodal Input

### Audio Files

```typescript
const result = await model.generateContent({
  contents: [{
    role: 'user',
    parts: [
      {
        inlineData: {
          data: audioBuffer.toString('base64'),
          mimeType: 'audio/mp3' // or audio/wav, audio/ogg, etc.
        }
      },
      { text: prompt }
    ]
  }],
  generationConfig: { /* ... */ }
});
```

### Video Files

```typescript
const result = await model.generateContent({
  contents: [{
    role: 'user',
    parts: [
      {
        inlineData: {
          data: videoBuffer.toString('base64'),
          mimeType: 'video/mp4' // or video/mpeg, video/webm, etc.
        }
      },
      { text: prompt }
    ]
  }],
  generationConfig: { /* ... */ }
});
```

### Image Files

```typescript
const result = await model.generateContent({
  contents: [{
    role: 'user',
    parts: [
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/png' // or image/jpeg, image/webp, etc.
        }
      },
      { text: prompt }
    ]
  }],
  generationConfig: { /* ... */ }
});
```

## Schema Best Practices

### 1. Keep Descriptions Concise

Schema size counts toward input token limit:
```typescript
// ✅ Good - concise but clear
{ type: SchemaType.STRING, description: "User's full name" }

// ❌ Bad - unnecessarily verbose
{ type: SchemaType.STRING, description: "This field represents the complete full name of the user including first name, middle name if applicable, and last name" }
```

### 2. Mark Critical Fields as Required

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    criticalField: { type: SchemaType.STRING },
    optionalField: { type: SchemaType.STRING }
  },
  required: ["criticalField"] // Forces model to populate this field
}
```

### 3. Use Enums for Controlled Output

```typescript
{
  type: SchemaType.STRING,
  enum: ["small", "medium", "large"],
  description: "Size category"
}
```

### 4. Ensure Consistent Ordering

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    field1: { type: SchemaType.STRING },
    field2: { type: SchemaType.NUMBER }
  },
  propertyOrdering: ["field1", "field2"] // Ensures consistent key order in JSON
}
```

### 5. Simplify When Encountering Errors

If you get `InvalidArgument: 400` errors:
- Shorten field names
- Reduce nesting depth
- Remove optional constraints (min/max, format, etc.)
- Split complex schema into multiple simpler ones

## Common Patterns

### Quality Gate Pattern

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    canProcess: {
      type: SchemaType.BOOLEAN,
      description: "Can the input be processed confidently?"
    },
    qualityIssues: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of issues preventing processing"
    },
    data: {
      type: SchemaType.OBJECT,
      properties: { /* actual data fields */ }
    }
  },
  required: ["canProcess"]
}
```

### Confidence Scoring Pattern

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    value: { type: SchemaType.STRING, description: "Extracted value" },
    confidence: { type: SchemaType.NUMBER, description: "Confidence 0.0-1.0" },
    alternatives: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          value: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER }
        }
      },
      description: "Alternative interpretations if confidence < 0.7"
    }
  },
  required: ["value", "confidence"]
}
```

### Hierarchical Data Pattern

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          parentId: { type: SchemaType.STRING, description: "ID of parent item" }
        }
      }
    }
  }
}
```

## Thinking Models & Token Budgets

### The Problem

Gemini 2.5 models (Flash, Pro) have built-in "thinking" capabilities that consume output tokens. When thinking tokens + output tokens exceed `maxOutputTokens`, the response is **empty**.

**Key Formula:**
```
thoughts_token_count + output_token_count > max_output_tokens → EMPTY RESPONSE
```

**Symptom:** `finishReason: 'MAX_TOKENS'` with empty `response.text()`

**Reference:** https://ai.google.dev/gemini-api/docs/thinking

### Token Budget Guidelines

Thinking can use 1000-6000+ tokens depending on task complexity. Set `maxOutputTokens` to account for both thinking and actual output:

| Operation | Expected Output | Thinking Buffer | Recommended maxOutputTokens |
|-----------|-----------------|-----------------|----------------------------|
| Title generation | ~50 tokens | 2048 | **2048** |
| Quality assessment | ~100 tokens | 2048 | **2048** |
| Item extraction | ~2000 tokens | 4096 | **8192** |
| List extraction | ~1000 tokens | 4096 | **8192** |
| Hierarchy mapping | ~2000 tokens | Dynamic | **Dynamic** (see below) |

### Dynamic Token Calculation

For complex tasks where reasoning scales with input complexity:

```typescript
function calculateHierarchyTokens(itemCount: number, containerCount: number): {
  thinkingBudget: number;
  maxOutputTokens: number;
} {
  const MIN_THINKING = 2048;
  const TOKENS_PER_ITEM = 64;       // Each item adds relationship complexity
  const TOKENS_PER_CONTAINER = 128; // Containers are hierarchical, more complex

  const complexityTokens = (itemCount * TOKENS_PER_ITEM) + (containerCount * TOKENS_PER_CONTAINER);
  const thinkingBudget = Math.max(MIN_THINKING, MIN_THINKING + complexityTokens);

  const BASE_OUTPUT = 2000;
  const maxOutputTokens = thinkingBudget + BASE_OUTPUT;

  return { thinkingBudget, maxOutputTokens };
}

// Examples:
// 5 items, 3 containers → thinking: 2752, max: 4752
// 20 items, 10 containers → thinking: 4608, max: 6608
// 50 items, 20 containers → thinking: 7808, max: 9808
```

### Controlling Thinking Behavior

**Option 1: Disable Thinking (Simple Tasks)**
```typescript
generationConfig: {
  maxOutputTokens: 256,
  thinkingConfig: {
    thinkingBudget: 0  // No thinking, pure extraction
  }
}
```
Best for: Title generation, quality assessment - tasks that don't benefit from reasoning.

**Option 2: Let Model Decide (Complex Tasks)**
```typescript
generationConfig: {
  maxOutputTokens: 8192,  // Must be large enough for thinking + output
  thinkingConfig: {
    thinkingBudget: -1  // Dynamic - model decides how much to think
  }
}
```
Best for: Complex extraction, relationship mapping, multi-step reasoning.

### Monitoring Token Usage

Log token usage to optimize limits over time:

```typescript
const response = await model.generateContent({...});

logger.info('Gemini token usage', {
  category: 'gemini-tokens',
  operation: 'title_generation',
  promptTokens: response.usageMetadata?.promptTokenCount,
  outputTokens: response.usageMetadata?.candidatesTokenCount,
  thoughtsTokens: response.usageMetadata?.thoughtsTokenCount,  // Key metric!
  totalTokens: response.usageMetadata?.totalTokenCount,
  maxOutputTokens: configuredMaxTokens,
  finishReason: response.candidates?.[0]?.finishReason,
  responseEmpty: !response.text()?.trim()
});
```

Target: `finishReason === 'MAX_TOKENS'` rate < 1%

## Error Handling

### Common Errors

**InvalidArgument: 400**
- Cause: Schema too complex
- Solution: Simplify schema, shorten names, reduce constraints

**Empty Response from Thinking Models**
- Cause: `thoughts_token_count + output_token_count > max_output_tokens`
- Symptom: `finishReason: 'MAX_TOKENS'` with empty response text
- Solution: Increase `maxOutputTokens` significantly (2048+ for simple tasks, 8192+ for complex)
- Alternative: Disable thinking with `thinkingConfig: { thinkingBudget: 0 }`

**Empty or Malformed Response**
- Cause: Prompt unclear or conflicting with schema
- Solution: Align prompt instructions with schema structure

**Missing Required Fields**
- Cause: Schema allows optional fields by default
- Solution: Explicitly mark fields as `required: ["field1", "field2"]`

**Inconsistent Output Across Runs**
- Cause: Temperature > 0
- Solution: Set `temperature: 0` for deterministic extraction

### Debugging Strategy

1. **Test without schema**: Run prompt without `responseSchema` to see natural output
2. **Align schema to output**: Design schema that matches model's natural response structure
3. **Add constraints gradually**: Start simple, add required fields/enums incrementally
4. **Log usage metadata**: Monitor token counts to optimize schema size
