---
name: gemini-prompt-engineer
description: Iteratively improve and optimize Gemini API prompts using 2026 prompt engineering best practices, structured output techniques, context caching, and Gemini-specific strategies. Use this skill when working with Gemini prompts, analyzing prompt performance, implementing structured output schemas, debugging Gemini API responses, or implementing context caching for cost reduction.
---

# Gemini Prompt Engineer

## Overview

Systematically analyze, iterate, and optimize prompts for Google's Gemini API using evidence-based prompt engineering techniques. This skill provides a structured framework for improving prompt quality, implementing structured JSON output, leveraging context caching, and maximizing Gemini's unique capabilities including multimodal processing, chain-of-thought reasoning, and coreference resolution.

## Current Model Reference (as of 2026)

| Model | Best For | Input ($/1M) | Output ($/1M) | Speed (tok/s) |
|-------|----------|--------------|---------------|---------------|
| `gemini-3.1-flash-lite` | **Best price-performance overall** | $0.25 | $1.50 | 363 |
| `gemini-2.5-flash` | Strong reasoning, long context (1M) | $0.30 | $2.50 | 249 |
| `gemini-2.5-flash-lite` | Cheapest, fastest for simple tasks | $0.10 | $0.40 | 366 |
| `gemini-2.5-pro` | Complex reasoning, coding, highest quality | varies | varies | — |
| `gemini-3.1-pro-preview` | State-of-the-art, agentic, coding | $2.00–4.00 | $12.00–18.00 | — |

**Recommendation**: Use `gemini-3.1-flash-lite` as the default workhorse — it outperforms `gemini-2.5-flash` on most benchmarks at lower cost. Use `gemini-2.5-pro` or `gemini-3.1-pro-preview` for complex reasoning. Use `gemini-2.5-flash` when you need the 1M token context window.

See `references/gemini_api_reference.md` for full parameter specs, schema syntax, and pricing.

## Core Capabilities

### 1. Prompt Analysis & Auditing

Evaluate existing Gemini prompts against best practices:

**Quality Assessment Framework:**
- **Goal Clarity**: Is the objective and success criteria clearly defined?
- **Output Specification**: Is the desired format, structure, length, and tone explicit?
- **Constraints**: Are limits (scope, rules, token budget) properly defined?
- **Context**: Is sufficient domain knowledge, examples, and data provided?
- **Evaluation Criteria**: Are acceptance criteria or rubrics specified?
- **Next Steps**: Are follow-up actions or error handling paths clear?

**Gemini-Specific Checks:**
- **Structured Output**: Is `responseMimeType: "application/json"` with `responseSchema` used for JSON?
- **Few-Shot Examples**: Are 2-5 examples provided to guide output patterns?
- **Temperature Setting**: Is temperature=0 used for deterministic data extraction?
- **Schema Efficiency**: Is the schema size optimized (counts toward token limit)?
- **Required Fields**: Are critical fields explicitly marked as required in schema?
- **Multimodal Instructions**: For video/images, are visual analysis capabilities leveraged?

**Analysis Output Format:**
```markdown
## Prompt Analysis Report

### Strengths
- [List what the prompt does well]

### Weaknesses
- [List issues, gaps, or anti-patterns]

### Gemini-Specific Opportunities
- [Gemini capabilities not being utilized]

### Priority Improvements
1. [Highest impact change]
2. [Second priority]
3. [Additional improvements]
```

### 2. Structured Output Schema Design

Design and optimize responseSchema configurations for Gemini's structured output:

**Schema Design Principles:**
- Use OpenAPI 3.0 data types: `string`, `integer`, `number`, `boolean`, `array`, `object`
- Mark critical fields as `required: ["field1", "field2"]` to force model responses
- Add `description` to every field to guide the model's interpretation
- Use `enum` for fields with predefined options (e.g., `enum: ["low", "medium", "high"]`)
- Use `propertyOrdering` to ensure consistent property order in responses
- Keep schema names short (counts toward token limit)

**Common Schema Patterns:**

```typescript
// FieldValue pattern (with confidence scoring)
{
  type: SchemaType.OBJECT,
  properties: {
    value: { type: SchemaType.STRING, description: "The extracted value" },
    confidence: { type: SchemaType.NUMBER, description: "Confidence 0.0-1.0" },
    alternatives: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          value: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER }
        },
        required: ["value", "confidence"]
      },
      description: "Alternative interpretations if confidence < 0.7"
    }
  },
  required: ["value", "confidence"]
}

// Enum pattern (for controlled outputs)
{
  type: SchemaType.STRING,
  enum: ["category_a", "category_b", "category_c"],
  description: "Classification category"
}

// Nested object pattern (for hierarchical data)
{
  type: SchemaType.OBJECT,
  properties: {
    parent: {
      type: SchemaType.OBJECT,
      properties: {
        id: { type: SchemaType.STRING },
        children: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING }
        }
      },
      required: ["id"]
    }
  },
  required: ["parent"]
}
```

**Schema Troubleshooting:**
- **InvalidArgument: 400 errors**: Schema too complex - shorten names, reduce constraints
- **Missing expected fields**: Mark as `required` in schema
- **Inconsistent output**: Add `propertyOrdering` field
- **Unexpected format**: Review model output without schema first, then align schema

### 3. Prompt Optimization Techniques

Apply 2025 prompt engineering best practices:

#### GOLDEN Framework

Structure prompts using the GOLDEN framework for comprehensive coverage:

1. **Goal**: Define objective and success criteria
2. **Output**: Specify format, length, tone, structure
3. **Limits**: Set scope, rules, budget, token constraints
4. **Data**: Provide context, examples, sources
5. **Evaluation**: Define rubrics or acceptance criteria
6. **Next steps**: Specify error handling or follow-up actions

#### Few-Shot Prompting (Recommended for Gemini)

**Best Practice**: "Always include few-shot examples in your prompts" (official Gemini guidance)

**Guidelines:**
- Provide 2-5 examples showing desired input→output patterns
- Use **positive examples** (show correct approach, not what to avoid)
- Maintain **consistent formatting** (XML tags, whitespace, newlines matter)
- Examples regulate formatting, phrasing, and response patterns
- Models pick up patterns quickly; experiment with example count

**Example Structure:**
```
TASK: [Description]

EXAMPLE 1:
INPUT: [Sample input]
OUTPUT: [Desired output]

EXAMPLE 2:
INPUT: [Sample input]
OUTPUT: [Desired output]

Now process this input:
[Actual input to process]
```

#### Chain-of-Thought (CoT) Prompting

**When to Use:**
- Complex reasoning tasks (mathematical, logical, analytical)
- Multi-step problem solving
- Tasks requiring explanation of reasoning
- **Note**: Less effective for newer reasoning models (may be redundant)

**Implementation:**
```
Solve this step-by-step:

Step 1: [First reasoning step]
Step 2: [Second reasoning step]
Step 3: [Final conclusion]

Let's think through this systematically...
```

**Advanced: Cognitive Chain-of-Thought (CoCoT)**

For tasks involving social context, intent disambiguation, or nuanced reasoning:
```
Analyze this in three stages:

1. PERCEPTION: What is literally happening?
2. SITUATION: What is the broader context?
3. NORM: What are the relevant social/domain rules?

Based on this analysis: [conclusion]
```

#### Prefix Strategy

Signal expected formats using input/output prefixes:

```
English: [Input text]
JSON: [Expected JSON output]

French: [Input text in French]
JSON: [Expected JSON output]
```

#### Prompt Decomposition

Break complex tasks into simpler components:

**Sequential Chaining**: Connect prompts where output of one feeds next
**Parallel Processing**: Handle different data sections simultaneously
**Hierarchical Breakdown**: Multi-level task decomposition

### 4. Coreference Resolution & Context Management

Optimize prompts for temporal context tracking and demonstrative resolution (critical for conversational/narrative inputs):

**Problem**: Models struggle with "this", "that", "here", "it" without explicit antecedent tracking

**Solution Framework:**
1. **Instruct early context establishment**: Tell model to identify global context statements
2. **Track demonstratives**: Explicitly ask model to resolve "this box" → "blue box"
3. **Apply global context**: Use established defaults for subsequent ambiguous references
4. **Temporal ordering**: Process chronologically, tracking recency for pronoun resolution

**Template for Coreference-Heavy Tasks:**
```
CRITICAL: COREFERENCE RESOLUTION & TEMPORAL CONTEXT

**Your task:**
1. Identify early context establishment (e.g., "everything goes in [container]")
2. Track demonstratives: resolve "this/that/these/those" to specific antecedents
3. Apply global context: use established defaults for ambiguous references
4. Track temporal order: earlier mentions establish antecedents for later pronouns

**Complete contextAnalysis FIRST**:
- globalContext: Overall context statement identified
- defaultContainer: What "this" or "that" refers to by default
- temporalReferences: List resolved references (e.g., "this box → blue box")

Then proceed with data extraction using that context awareness.
```

### 5. Multimodal Prompt Engineering (Video/Image)

Leverage Gemini's native multimodal capabilities:

**Video/Image Analysis Instructions:**
```
VIDEO ANALYSIS CAPABILITIES:
- Use VISUAL information to identify items, brands, colors, labels, text
- Combine visual and audio cues for maximum accuracy
- Read any text, labels, or brand names visible in frames
- Assess condition based on visual appearance
- Identify objects by visual characteristics (color, size, shape)
- Use spatial relationships visible to understand context

CONFIDENCE SCORING (Multimodal):
- 0.9-1.0: Crystal clear visuals/audio, text easily readable
- 0.7-0.89: Good clarity, minor blur/noise
- 0.5-0.69: Moderate clarity, some blur/noise
- 0.0-0.49: Poor quality, very blurry, unclear
```

**Visual Priority Instruction:**
```
When visual and audio information conflict, prioritize visual evidence.
```

### 6. Iteration Protocol

Systematically improve prompts through testing:

**Iteration Workflow:**
1. **Baseline Test**: Run current prompt, observe output
2. **Identify Gap**: Compare output to desired outcome - what's missing/wrong?
3. **Targeted Change**: Make ONE specific change:
   - Add/revise examples
   - Clarify instructions
   - Adjust schema
   - Add constraints
   - Rephrase using different vocabulary
4. **Test Again**: Run modified prompt
5. **Compare Results**: Did the change improve output?
6. **Document**: Record what worked/didn't work
7. **Repeat**: Continue until output meets requirements

**Change Categories:**
- **Rephrasing**: Use different vocabulary for same instruction
- **Analogous Tasks**: Switch to equivalent task with different framing
- **Reordering**: Move prompt sections to different positions
- **Parameter Tuning**: Adjust temperature, maxTokens, topK, topP

### 7. Quality Assurance & Validation

Validate prompt outputs meet requirements:

**Validation Checklist:**
- [ ] Schema compliance (all required fields present)
- [ ] Data type correctness (string/number/boolean/array/object)
- [ ] Confidence scores within 0.0-1.0 range
- [ ] Alternative interpretations provided when confidence < 0.7
- [ ] No hallucinated data (verify against input)
- [ ] Consistent formatting across multiple runs (temperature=0)
- [ ] Edge cases handled (empty input, missing data, errors)
- [ ] Error messages clear and actionable

**A/B Testing Framework:**
```
Test two prompt versions with same input:

Prompt A: [Current version]
Prompt B: [Modified version]

Input: [Test case]

Results:
- Prompt A Output: [...]
- Prompt B Output: [...]

Winner: [A/B] because [reasoning]
```

## Parameter Tuning Guide

Optimize Gemini generation config parameters:

**Temperature:**
- `0`: Deterministic, consistent output (best for data extraction)
- `0.3-0.5`: Slightly creative but mostly consistent
- `0.7-0.9`: Creative, varied output (best for content generation)
- `1.0+`: Highly random and creative

**Max Tokens:**
- Set based on expected output length
- Account for schema size (counts toward input limit)
- Monitor `usageMetadata` to optimize

**TopK & TopP:**
- `topK`: Limits vocabulary to top K tokens (lower = more focused)
- `topP`: Nucleus sampling (0.9 = top 90% probability mass)
- Use together for controlled creativity

## Common Pitfalls & Solutions

### Pitfall 1: Hallucinated Data
**Problem**: Model invents data not present in input
**Solution**: Add explicit instruction "DO NOT GUESS" with quality assessment gates

### Pitfall 2: Inconsistent JSON Format
**Problem**: Output format varies across runs
**Solution**: Use `responseSchema` with `responseMimeType: "application/json"` and `temperature: 0`

### Pitfall 3: Missing Required Fields
**Problem**: Schema fields not populated
**Solution**: Mark as `required: ["field1", "field2"]` in schema, add "REQUIRED" in descriptions

### Pitfall 4: Poor Confidence Scores
**Problem**: Model always returns 1.0 confidence
**Solution**: Provide scoring guidelines with examples at different confidence levels

### Pitfall 5: Schema Complexity Errors
**Problem**: InvalidArgument: 400 errors
**Solution**: Simplify schema - shorten names, reduce nested levels, remove excessive constraints

### Pitfall 6: Ignored Instructions
**Problem**: Model skips critical steps
**Solution**: Use visual markers (⚠️, **CRITICAL**, ALL CAPS), numbered steps, explicit ordering

### Pitfall 7: Token Limit Exceeded
**Problem**: Schema + prompt + input too large
**Solution**: Shorten schema descriptions, reduce examples, use references to external docs

### 8. Context Caching

Reduce costs and latency when the same large content is reused across requests. See `references/context_caching.md` for full details and code examples.

**Two mechanisms:**

- **Implicit caching** (automatic): Enabled by default on Gemini 2.5+ models. No code changes needed — cache hits apply a **75-90% discount** automatically. Savings appear in `usageMetadata.cachedContentTokenCount`.
- **Explicit caching** (manual): You create a named cache with a TTL and reference it by ID. Guarantees savings for predictable workloads.

**Prompt structure for maximum cache hits:**
```
[STATIC: system instructions, large documents, reference data]  ← cached prefix
[DYNAMIC: user query, variable data]                             ← appended per request
```

**When to use explicit caching:**
- Large system prompts (>1K tokens) reused across many requests
- Repeated analysis of the same document, video, or codebase
- Chatbots with extensive, stable context

**Minimum token thresholds for explicit caching:**

| Model | Min Tokens |
|-------|------------|
| Gemini 2.5 Flash | 1,024 |
| Gemini 2.5 Pro | 4,096 |
| Gemini 3 Flash Preview | 1,024 |
| Gemini 3.1 Pro Preview | 4,096 |

## Resources

### references/

- `gemini_api_reference.md`: Gemini API structured output docs, parameter specs, schema syntax, pricing
- `prompt_patterns.md`: Prompt templates for common use cases (classification, extraction, summarization, Q&A)
- `context_caching.md`: Context caching guide — explicit vs implicit, code examples, cost optimization patterns

### scripts/

- `test_prompt.py`: Automated prompt testing framework with A/B comparison and metric tracking
- `validate_schema.py`: Schema validation utility (checks syntax, required fields, type compliance)

## Quick Start Examples

### Example 1: Basic Structured Extraction

```typescript
const prompt = `Extract product information from this description.

REQUIRED FIELDS:
- productName: The product name
- price: Numeric price value
- category: Product category

OUTPUT FORMAT: JSON matching the schema

Description: ${userInput}`;

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    productName: { type: SchemaType.STRING, description: "Product name" },
    price: { type: SchemaType.NUMBER, description: "Price in USD" },
    category: { type: SchemaType.STRING, enum: ["electronics", "clothing", "food", "other"] }
  },
  required: ["productName", "price", "category"]
};

const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: schema
  }
});
```

### Example 2: Quality-Gated Extraction with Confidence

```typescript
const prompt = `⚠️ CRITICAL FIRST STEP - QUALITY ASSESSMENT ⚠️

Before extracting data, assess if the input is processable:
1. Is the input clear and understandable?
2. Can you confidently extract the requested information?
3. If NO, set canProcess=false and return empty data

ONLY proceed with extraction if canProcess=true.

Extract user profile information with confidence scores:
- Full name
- Email address
- Phone number

Input: ${userInput}`;

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    canProcess: {
      type: SchemaType.BOOLEAN,
      description: "Can you confidently extract data from this input?"
    },
    qualityIssues: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Issues preventing processing: unclear_input, missing_data, corrupted_text"
    },
    name: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.STRING },
        confidence: { type: SchemaType.NUMBER }
      }
    },
    email: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.STRING },
        confidence: { type: SchemaType.NUMBER }
      }
    }
  },
  required: ["canProcess"]
};
```

### Example 3: Few-Shot with Coreference Resolution

```typescript
const prompt = `Extract task assignments, resolving pronouns and demonstratives.

EXAMPLE 1:
INPUT: "Alice will handle the frontend. Bob takes the backend. She'll also do testing."
OUTPUT:
{
  "assignments": [
    {"person": "Alice", "tasks": ["frontend", "testing"]},
    {"person": "Bob", "tasks": ["backend"]}
  ],
  "coreferences": ["She → Alice"]
}

EXAMPLE 2:
INPUT: "Put all documents in this blue folder. Add the reports, spreadsheets, and contracts."
OUTPUT:
{
  "assignments": [
    {"item": "reports", "location": "blue folder"},
    {"item": "spreadsheets", "location": "blue folder"},
    {"item": "contracts", "location": "blue folder"}
  ],
  "coreferences": ["this blue folder → blue folder (established as default)"]
}

Now process this input with the same coreference resolution:
${userInput}`;
```

## Best Practices Summary

1. **Always use structured output** (`responseSchema` + `responseMimeType: "application/json"`)
2. **Include 2-5 few-shot examples** to guide model behavior
3. **Set temperature=0** for deterministic data extraction
4. **Mark critical fields as required** in schema
5. **Add quality assessment gates** before extraction (canProcess checks)
6. **Provide confidence scoring guidelines** with examples at different levels
7. **Use visual markers** (⚠️, **CRITICAL**) for important instructions
8. **Implement coreference resolution** for conversational/narrative inputs
9. **Leverage multimodal capabilities** explicitly for video/image inputs
10. **Iterate systematically** - one change at a time, test, compare, document
11. **Structure prompts for caching** - static content first, dynamic content last
12. **Monitor `cachedContentTokenCount`** in usageMetadata to verify cache hits
13. **Use explicit caching** for large stable contexts (system prompts, docs, codebases)
