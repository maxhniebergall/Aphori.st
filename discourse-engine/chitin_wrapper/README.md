# Discourse Engine Service

The Discourse Engine is a FastAPI microservice that provides advanced argument mining and analysis capabilities for the Chitin Social platform. It extracts argument data units (ADUs), detects relations between arguments, generates embeddings, and validates claim equivalence using retrieval-augmented generation (RAG).

## Table of Contents

- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Local Development](#local-development)
- [Docker Deployment](#docker-deployment)
- [Environment Variables](#environment-variables)
- [Model Caching](#model-caching)
- [Health Checks](#health-checks)
- [SDK Compatibility](#sdk-compatibility)

## Architecture

The service consists of four core components:

### 1. Argument Miner (ArgumentMiner)
Extracts Argument Data Units (ADUs) from text using the pre-trained sentence-transformer model. ADUs are atomic propositions that form the building blocks of arguments.

- **Input**: Raw text content
- **Output**: List of ADUs with type (claim/premise), text, span offsets, and confidence scores
- **Model**: `sentence-transformers/paraphrase-distilroberta-base-v2`

### 2. Relation Detector (RelationDetector)
Analyzes relationships between extracted ADUs, identifying support and attack relations.

- **Input**: ADU embeddings and ADU texts
- **Output**: Relations with source/target ADU IDs, relation type, and confidence
- **Method**: Cosine similarity on embeddings + heuristic rules

### 3. Embeddings Service
Generates 768-dimensional dense vector embeddings using the Gemini API. These embeddings are used for:
- Semantic search
- Similarity matching for canonical claim deduplication
- Relation detection

- **Model**: Gemini 1.5 Flash (768-dim embeddings)
- **Dimension**: 768
- **Usage**: RAG retrieval, semantic search, similarity matching

### 4. RAG Validator (LLM Validation)
Uses Gemini Flash LLM with structured output to validate whether new claims are equivalent to existing canonical claims. This prevents duplicate claims in the knowledge base.

- **Input**: New claim text + candidate canonical claims with similarity scores
- **Output**: Equivalence decision + explanation
- **LLM**: Gemini 1.5 Flash with JSON structured output

## API Endpoints

### POST /health

Health check endpoint that returns service status and model loading state.

**Response:**
```json
{
  "status": "ok",
  "models_loaded": true
}
```

### POST /analyze/adus

Extracts Argument Data Units from text. Each ADU represents an atomic claim or premise.

**Request:**
```json
{
  "texts": [
    {
      "id": "post_123",
      "text": "Climate change is real. We must act now."
    }
  ]
}
```

**Response:**
```json
{
  "adus": [
    {
      "id": "adu_1",
      "adu_type": "claim",
      "text": "Climate change is real",
      "span_start": 0,
      "span_end": 22,
      "confidence": 0.95
    },
    {
      "id": "adu_2",
      "adu_type": "claim",
      "text": "We must act now",
      "span_start": 24,
      "span_end": 39,
      "confidence": 0.88
    }
  ]
}
```

**Notes:**
- Span offsets refer to character positions in the original text
- Confidence scores range from 0 to 1
- First request will be slower (model warmup)

### POST /analyze/relations

Detects support and attack relations between ADUs. Uses embeddings to measure semantic similarity.

**Request:**
```json
{
  "adus": [
    {
      "id": "adu_1",
      "text": "Climate change is real"
    },
    {
      "id": "adu_2",
      "text": "We must act now"
    }
  ],
  "embeddings": [
    [0.1, 0.2, 0.3, ...],  // 768 dimensions
    [0.15, 0.25, 0.35, ...]
  ]
}
```

**Response:**
```json
{
  "relations": [
    {
      "source_adu_id": "adu_1",
      "target_adu_id": "adu_2",
      "relation_type": "support",
      "confidence": 0.82
    }
  ]
}
```

**Notes:**
- Requires pre-computed embeddings for each ADU
- Embeddings must be 768-dimensional vectors
- Relations are directional (source → target)

### POST /embed/content

Generates 768-dimensional embeddings for text using Gemini API. Used for:
- ADU embeddings (for relation detection)
- Content embeddings (for semantic search)
- Canonical claim embeddings (for similarity matching)

**Request:**
```json
{
  "texts": [
    "Climate change is causing sea level rise",
    "Renewable energy reduces carbon emissions"
  ]
}
```

**Response:**
```json
{
  "embeddings_768": [
    [0.1234, 0.5678, ..., 0.9012],  // 768 values
    [0.2345, 0.6789, ..., 0.0123]
  ]
}
```

**Notes:**
- Returns exactly 768-dimensional vectors
- Vectors are normalized (L2)
- All requests are cached in GCS for cost optimization

### POST /validate/claim-equivalence

Uses RAG pipeline to determine if a new claim is equivalent to existing canonical claims. The process:
1. Send new claim + candidate claims with similarity scores
2. LLM analyzes semantic equivalence and context
3. Returns structured decision

**Request:**
```json
{
  "new_claim": "We must take action on climate change",
  "candidates": [
    {
      "id": "canonical_1",
      "text": "Action on climate change is necessary",
      "similarity": 0.87
    },
    {
      "id": "canonical_2",
      "text": "Climate policy implementation is urgent",
      "similarity": 0.84
    }
  ]
}
```

**Response (Equivalent):**
```json
{
  "is_equivalent": true,
  "canonical_claim_id": "canonical_1",
  "explanation": "Both claims assert that climate change requires immediate action, differing only in phrasing"
}
```

**Response (Not Equivalent):**
```json
{
  "is_equivalent": false,
  "canonical_claim_id": null,
  "explanation": "New claim emphasizes urgency of action, while canonical claims focus on specific policy measures"
}
```

**Notes:**
- Only called for claims with vector similarity > 0.75
- LLM can override high similarity scores when context differs
- All decisions include explanations for transparency
- Structured output enforces JSON schema

## Local Development

### Prerequisites

- Python 3.11+
- Docker (for local Redis/PostgreSQL if needed)
- Google Cloud credentials for Gemini API access

### Setup

1. **Clone and install dependencies:**
```bash
cd discourse-engine/chitin_wrapper
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env with your Google Cloud credentials
export GOOGLE_API_KEY=your_key_here
export DISCOURSE_ENGINE_PORT=8000
```

3. **Run the service:**
```bash
python -m uvicorn main:app --reload --port 8000
```

4. **Test health endpoint:**
```bash
curl http://localhost:8000/health
```

### Development Tips

- The service caches all model downloads in `./models/` directory
- First request after startup will be slow (model loading)
- Subsequent requests are faster (models cached in memory)
- Embeddings are cached in GCS to avoid re-computing

## Docker Deployment

### Build Image

```bash
cd discourse-engine
docker build -t chitin-discourse-engine:latest .
```

### Run Container

```bash
docker run -d \
  --name discourse-engine \
  -p 8000:8000 \
  -e GOOGLE_API_KEY=${GOOGLE_API_KEY} \
  -e DISCOURSE_ENGINE_PORT=8000 \
  -v /path/to/cache:/app/models \
  chitin-discourse-engine:latest
```

### Docker Compose

```yaml
services:
  discourse-engine:
    build: ./discourse-engine
    ports:
      - "8000:8000"
    environment:
      GOOGLE_API_KEY: ${GOOGLE_API_KEY}
      DISCOURSE_ENGINE_PORT: 8000
    volumes:
      - ./models:/app/models
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Production Deployment

For production, ensure:

1. **Models are pre-loaded**: Warm up models before receiving traffic
2. **Cache is persistent**: Use mounted volumes for model cache
3. **API keys are secure**: Use secrets manager, not environment variables
4. **Resource limits**: 4+ CPU cores, 8+ GB RAM (Gemini model is large)
5. **Request timeout**: Set to 5+ minutes for first request (model loading)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_API_KEY` | Required | Google Cloud API key for Gemini access |
| `DISCOURSE_ENGINE_PORT` | 8000 | Port to run the service on |
| `DISCOURSE_ENGINE_HOST` | 0.0.0.0 | Host to bind to |
| `MODEL_CACHE_DIR` | ./models | Directory to cache downloaded models |
| `GCS_CACHE_BUCKET` | chitin-embedding-cache | GCS bucket for embedding cache |
| `LOG_LEVEL` | INFO | Python logging level |

## Model Caching

The service implements two-level caching for cost optimization:

### Local Cache (Disk)

Models are downloaded and cached locally:
- `./models/sentence-transformers/` - Argument extraction models
- `./models/gemini-api/` - API models (referenced by ID)

First request will be slow (10-30s depending on network). Subsequent requests use cached models.

### Embedding Cache (GCS)

Embeddings are cached in Google Cloud Storage to avoid recomputing:

```
gs://chitin-embedding-cache/
├── content/
│   ├── {hash}.json       # Content embeddings
│   └── index.json        # Hash index
├── adu/
│   ├── {hash}.json       # ADU embeddings
│   └── index.json
└── canonical/
    ├── {hash}.json       # Canonical claim embeddings
    └── index.json
```

Cache keys are SHA256 hashes of the input text. To check cache:

```bash
gsutil ls gs://chitin-embedding-cache/content/
```

To clear cache:

```bash
gsutil -m rm -r gs://chitin-embedding-cache/*
```

## Health Checks

### Readiness Check

The `/health` endpoint returns `models_loaded: true` only when all models are fully loaded:

```bash
curl http://localhost:8000/health
```

### Liveness Check

The service responds to any request while running. Use standard Docker health checks:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### Monitoring

Key metrics to monitor:

1. **Model Load Time**: Time for first request (should be 10-30s)
2. **Request Latency**: Subsequent requests should be <2s
3. **API Rate Limits**: Gemini API has rate limits (100 req/min)
4. **Cache Hit Rate**: Monitor GCS cache hits to optimize costs
5. **Memory Usage**: Model loading uses 2-4 GB RAM

## SDK Compatibility

The service is compatible with multiple Google Generative AI SDKs:

### Preferred: google-genai

```python
import google.genai as genai
from google.genai import types

genai.configure(api_key="YOUR_API_KEY")

response = genai.models.generate_content(
    model="gemini-1.5-flash",
    contents="Generate embeddings for this text",
)
```

### Fallback: google-generativeai

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_API_KEY")

model = genai.GenerativeModel("gemini-1.5-flash")
response = model.generate_content("Text to embed")
```

The service automatically detects and uses whichever SDK is available.

## Error Handling

### Common Errors

**`models_loaded: false`** - Models still loading
- Solution: Retry request after 10-30 seconds

**`API_KEY not found`** - Missing Google Cloud credentials
- Solution: Set `GOOGLE_API_KEY` environment variable

**`rate_limit_exceeded`** - Too many requests to Gemini API
- Solution: Implement exponential backoff in client

**`invalid_input`** - Malformed request JSON
- Solution: Verify request schema matches endpoint documentation

### Debugging

Enable detailed logging:

```bash
LOG_LEVEL=DEBUG python -m uvicorn main:app --reload
```

Check model loading:

```bash
# Verify sentence-transformers installed
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-distilroberta-base-v2')"

# Verify Gemini API access
curl -H "Authorization: Bearer ${GOOGLE_API_KEY}" https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash
```

## Performance Tuning

### Request Batching

For multiple texts, batch requests:

```bash
# Good: Batch 100 texts in single request
POST /embed/content
{"texts": ["text1", "text2", ..., "text100"]}

# Avoid: Individual requests for each text
POST /embed/content
{"texts": ["text1"]}
```

### Caching Strategy

1. **Always use text hashes** for cache keys
2. **Check GCS before embedding** if cost is a concern
3. **Preload popular embeddings** during idle times
4. **Monitor cache hit rate** to optimize bucket retention

### Resource Allocation

- **CPU**: 4+ cores for concurrent requests
- **RAM**: 8+ GB for model loading
- **Network**: 10+ Mbps for API calls
- **Storage**: 2+ GB for model cache

## Support

For issues, questions, or feature requests:

1. Check error logs: `docker logs discourse-engine`
2. Review Google Generative AI documentation: https://ai.google.dev/
3. Monitor API dashboard: https://console.cloud.google.com/
4. Open issues on the Chitin Social repository
