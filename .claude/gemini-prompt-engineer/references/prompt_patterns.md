# Gemini Prompt Patterns Library

Collection of production-tested prompt templates for common use cases.

## Pattern 1: Data Extraction with Quality Gates

**Use Case**: Extract structured data from text/audio/video with confidence scoring

```
⚠️ CRITICAL FIRST STEP - QUALITY ASSESSMENT ⚠️

Before extracting data, assess input quality:
1. Is the input clear and understandable?
2. Can you confidently extract the requested information?
3. If NO, set canProcess=false and return empty data arrays

ONLY proceed with extraction if canProcess=true.

TASK: Extract [data description]

REQUIRED FIELDS:
- [field1]: [description]
- [field2]: [description]

CONFIDENCE SCORING:
- 0.9-1.0: Crystal clear, no ambiguity
- 0.7-0.89: Clear with minor uncertainty
- 0.5-0.69: Moderate clarity, multiple interpretations possible
- 0.0-0.49: Poor quality, high ambiguity

ALTERNATIVES RULE:
If confidence < 0.7, provide up to 3 alternative interpretations.

INPUT:
[Input data here]

Extract the data following the schema.
```

**Schema Template**:
```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    processingStatus: {
      type: SchemaType.OBJECT,
      properties: {
        canProcess: { type: SchemaType.BOOLEAN },
        qualityLevel: {
          type: SchemaType.STRING,
          enum: ["excellent", "good", "fair", "poor", "unintelligible"]
        },
        issues: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING }
        }
      },
      required: ["canProcess", "qualityLevel"]
    },
    extractedData: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          field: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.STRING },
              confidence: { type: SchemaType.NUMBER },
              alternatives: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    value: { type: SchemaType.STRING },
                    confidence: { type: SchemaType.NUMBER }
                  }
                }
              }
            },
            required: ["value", "confidence"]
          }
        }
      }
    }
  },
  required: ["processingStatus"]
}
```

## Pattern 2: Classification with Few-Shot Examples

**Use Case**: Categorize text into predefined classes

```
Classify the following text into one of these categories: [list categories]

EXAMPLE 1:
TEXT: "I need to return this product, it arrived damaged"
CATEGORY: customer_complaint
CONFIDENCE: 0.95
REASONING: Explicit mention of product issue and return request

EXAMPLE 2:
TEXT: "When will my order arrive? I placed it 3 days ago"
CATEGORY: shipping_inquiry
CONFIDENCE: 0.92
REASONING: Direct question about delivery timeline

EXAMPLE 3:
TEXT: "Thank you for the excellent service!"
CATEGORY: positive_feedback
CONFIDENCE: 0.98
REASONING: Expression of gratitude and satisfaction

Now classify this text:
TEXT: [Input text]

Provide the category, confidence score (0.0-1.0), and brief reasoning.
```

**Schema Template**:
```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    category: {
      type: SchemaType.STRING,
      enum: ["category1", "category2", "category3"],
      description: "Classification category"
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence score 0.0-1.0"
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Brief explanation of classification decision"
    }
  },
  required: ["category", "confidence", "reasoning"]
}
```

## Pattern 3: Hierarchical Data Extraction

**Use Case**: Extract nested/hierarchical structures (containers, org charts, file systems)

```
Extract the hierarchical structure from this description.

UNDERSTANDING HIERARCHY:
- Parent items contain child items
- Track IMMEDIATE parent for each item
- Top-level items have no parent

EXAMPLE:
INPUT: "We have a blue box in the garage. Inside it are two bags: a red bag and a green bag. The red bag contains tools."

OUTPUT:
{
  "items": [
    {
      "name": {"value": "blue box", "confidence": 0.95},
      "parent": null,
      "location": {"value": "garage", "confidence": 0.98}
    },
    {
      "name": {"value": "red bag", "confidence": 0.93},
      "parent": {"value": "blue box", "confidence": 0.92}
    },
    {
      "name": {"value": "green bag", "confidence": 0.94},
      "parent": {"value": "blue box", "confidence": 0.92}
    },
    {
      "name": {"value": "tools", "confidence": 0.91},
      "parent": {"value": "red bag", "confidence": 0.89}
    }
  ]
}

Now extract the hierarchy from:
[Input description]
```

## Pattern 4: Coreference Resolution

**Use Case**: Resolve pronouns and demonstratives in conversational text

```
Extract information while resolving all pronouns and demonstratives.

CRITICAL: COREFERENCE RESOLUTION

**Your task:**
1. Identify context establishment statements (e.g., "everything goes in X")
2. Track demonstratives: resolve "this/that/these/those" to specific antecedents
3. Apply global context: use established defaults for ambiguous references
4. Process chronologically: earlier mentions establish antecedents for later pronouns

**Complete contextAnalysis FIRST**:
- globalContext: Overall context statement
- defaultReference: What "this/that" refers to by default
- temporalReferences: List all resolved references

EXAMPLE 1:
INPUT: "I have a blue folder. Put the reports in it. Also add the contracts."
OUTPUT:
{
  "contextAnalysis": {
    "globalContext": {"value": "blue folder established as default location", "confidence": 0.93},
    "defaultReference": {"value": "blue folder", "confidence": 0.92},
    "temporalReferences": [
      {"value": "it → blue folder", "confidence": 0.92}
    ]
  },
  "items": [
    {"name": "reports", "location": "blue folder"},
    {"name": "contracts", "location": "blue folder"}
  ]
}

EXAMPLE 2:
INPUT: "Alice finished the frontend. Bob completed the backend. She'll handle testing."
OUTPUT:
{
  "contextAnalysis": {
    "temporalReferences": [
      {"value": "She → Alice (recency + gender)", "confidence": 0.89}
    ]
  },
  "assignments": [
    {"person": "Alice", "tasks": ["frontend", "testing"]},
    {"person": "Bob", "tasks": ["backend"]}
  ]
}

Now process this input with full coreference resolution:
[Input text]
```

## Pattern 5: Multimodal (Video/Image) Analysis

**Use Case**: Extract information from video or images

```
Analyze this [video/image] and extract information.

VIDEO/IMAGE ANALYSIS CAPABILITIES:
- Use VISUAL information to identify items, brands, colors, labels, text
- Combine visual and audio cues (video only) for maximum accuracy
- Read any text, labels, or brand names visible
- Assess condition based on visual appearance
- Use spatial relationships to understand context

PRIORITY: When visual and audio information conflict, prioritize visual evidence.

CONFIDENCE SCORING (Multimodal):
- 0.9-1.0: Crystal clear visuals/audio, text easily readable, objects clearly identifiable
- 0.7-0.89: Good clarity, minor blur/noise, confident identification
- 0.5-0.69: Moderate clarity, some blur/noise, multiple interpretations possible
- 0.0-0.49: Poor quality, very blurry, unclear, high ambiguity

TASK: Extract [specific information]

REQUIRED FIELDS:
- [field1]: [description, with note to use visual cues]
- [field2]: [description, prioritizing visible information]

Analyze the [video/image] and extract all information following the schema.
```

## Pattern 6: Multi-Step Reasoning (Chain-of-Thought)

**Use Case**: Complex problem solving requiring step-by-step reasoning

```
Solve this problem using step-by-step reasoning.

APPROACH:
Step 1: Understand the problem - What is being asked?
Step 2: Identify relevant information - What data do we have?
Step 3: Plan the solution - What steps are needed?
Step 4: Execute - Perform calculations/analysis
Step 5: Verify - Does the answer make sense?

PROBLEM:
[Problem description]

Work through each step systematically and show your reasoning.
```

**Advanced: Cognitive Chain-of-Thought**

For social/contextual reasoning:
```
Analyze this situation using cognitive reasoning.

STAGE 1 - PERCEPTION: What is literally happening?
[Describe observable facts without interpretation]

STAGE 2 - SITUATION: What is the broader context?
[Analyze background, relationships, implicit information]

STAGE 3 - NORM: What are the relevant rules/expectations?
[Identify social norms, domain rules, or expectations]

CONCLUSION: Based on this analysis...
[Final determination with reasoning]

SITUATION:
[Input scenario]
```

## Pattern 7: Summarization with Key Points

**Use Case**: Summarize long content into structured key points

```
Summarize the following content into key points.

REQUIREMENTS:
- Extract 3-7 main points (adjust based on content length)
- Each point should be concise (1-2 sentences)
- Prioritize actionable information
- Include relevant details (numbers, dates, names)
- Maintain logical flow

FORMAT:
- Main Topic: [Topic summary]
- Key Points:
  1. [Point 1]
  2. [Point 2]
  ...

CONTENT:
[Input content]
```

**Schema Template**:
```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    mainTopic: {
      type: SchemaType.STRING,
      description: "Overall topic or theme"
    },
    keyPoints: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          point: { type: SchemaType.STRING, description: "Key point summary" },
          importance: {
            type: SchemaType.STRING,
            enum: ["high", "medium", "low"],
            description: "Importance level"
          },
          details: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "Supporting details"
          }
        },
        required: ["point", "importance"]
      },
      minItems: 3,
      maxItems: 7
    }
  },
  required: ["mainTopic", "keyPoints"]
}
```

## Pattern 8: Question Answering with Evidence

**Use Case**: Answer questions with supporting evidence from context

```
Answer the following question based on the provided context.

REQUIREMENTS:
1. Answer directly and concisely
2. Cite specific evidence from the context
3. If answer is not in context, explicitly state "Not mentioned in context"
4. Provide confidence score (0.0-1.0)

CONTEXT:
[Context information]

QUESTION:
[Question]

Provide: answer, evidence (quote from context), confidence score, reasoning
```

**Schema Template**:
```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    answer: {
      type: SchemaType.STRING,
      description: "Direct answer to the question"
    },
    evidence: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Quotes from context supporting the answer"
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence 0.0-1.0"
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Explanation of how evidence supports answer"
    },
    notInContext: {
      type: SchemaType.BOOLEAN,
      description: "True if answer cannot be determined from context"
    }
  },
  required: ["answer", "confidence", "notInContext"]
}
```

## Pattern 9: Sentiment Analysis with Aspects

**Use Case**: Analyze sentiment across different aspects

```
Analyze the sentiment of this text across different aspects.

ASPECTS TO EVALUATE:
- [Aspect 1: e.g., product quality]
- [Aspect 2: e.g., customer service]
- [Aspect 3: e.g., pricing]
- [Overall sentiment]

SENTIMENT SCALE:
- very_positive: Strong positive sentiment
- positive: Positive sentiment
- neutral: No clear positive or negative sentiment
- negative: Negative sentiment
- very_negative: Strong negative sentiment

For each aspect, provide:
- Sentiment rating
- Confidence score (0.0-1.0)
- Supporting quote from text
- Brief reasoning

TEXT:
[Input text]
```

## Pattern 10: Entity Extraction with Relationships

**Use Case**: Extract entities and their relationships

```
Extract all entities and their relationships from this text.

ENTITY TYPES:
- [Type 1: e.g., Person]
- [Type 2: e.g., Organization]
- [Type 3: e.g., Location]
- [Type 4: e.g., Date]

RELATIONSHIP TYPES:
- [Relationship 1: e.g., works_for]
- [Relationship 2: e.g., located_in]
- [Relationship 3: e.g., occurred_on]

EXAMPLE:
TEXT: "John Smith joined Acme Corp in New York on January 15, 2024."
OUTPUT:
{
  "entities": [
    {"text": "John Smith", "type": "Person", "confidence": 0.98},
    {"text": "Acme Corp", "type": "Organization", "confidence": 0.97},
    {"text": "New York", "type": "Location", "confidence": 0.99},
    {"text": "January 15, 2024", "type": "Date", "confidence": 0.99}
  ],
  "relationships": [
    {"subject": "John Smith", "predicate": "works_for", "object": "Acme Corp", "confidence": 0.95},
    {"subject": "Acme Corp", "predicate": "located_in", "object": "New York", "confidence": 0.88},
    {"subject": "John Smith", "predicate": "joined_on", "object": "January 15, 2024", "confidence": 0.96}
  ]
}

Now extract entities and relationships from:
[Input text]
```

## Combining Patterns

Patterns can be combined for complex tasks:

**Example: Multi-stage extraction**
1. Use Pattern 1 (Quality Gates) to assess input
2. Use Pattern 4 (Coreference Resolution) to resolve ambiguities
3. Use Pattern 3 (Hierarchical Extraction) to extract structure
4. Use Pattern 10 (Entity Extraction) to identify specific entities

**Example: Multimodal + Classification**
1. Use Pattern 5 (Multimodal Analysis) to extract visual information
2. Use Pattern 2 (Classification) to categorize based on extracted info
3. Use Pattern 8 (Q&A) to answer specific questions about the content
