# Gemini Puzzle Generation - Multiprocessing System

This directory contains the multi-processing task-based system for generating puzzles with Gemini embeddings. The system processes `theme_word + candidate_words` as atomic task units across multiple worker processes.

## Architecture Overview

### Task-Based Processing
- **Task Unit**: `ThemeProcessingTask` containing theme word + candidate words
- **Parallelization**: Multiple worker processes handle tasks independently
- **Rate Limiting**: Shared rate limiter ensures API limits are respected
- **Caching**: Thread-safe file-based cache for embeddings

### Key Components

#### 1. ThemeProcessingTask
- Atomic work unit: theme + candidates
- Retry logic and error handling
- Task metadata and priority

#### 2. ThemeWorker  
- Worker process handler
- Processes individual tasks with Gemini API
- Manages embedding cache and rate limiting

#### 3. GeminiTaskProcessor
- Main orchestrator
- Manages worker pool and task distribution
- Monitors progress and handles failures

#### 4. SharedRateLimiter
- Cross-process rate limiting
- Respects Gemini API limits (2900 RPM)
- Fair queuing across workers

#### 5. EmbeddingCacheManager
- Thread-safe file-based cache
- Atomic read/write operations
- Crash recovery and persistence

#### 6. ResultAggregator
- Collects results from workers
- Groups themes into puzzles
- Formats output for compatibility

## Configuration

Add to `params.yaml`:

```yaml
multiprocessing:
  enabled: true                    # Enable/disable multiprocessing
  worker_count: 6                  # Number of worker processes
  task_queue_size: 100            # Task queue capacity
  result_queue_size: 100          # Result queue capacity  
  max_concurrent_requests: 8       # Max concurrent API requests
  cache_sync_interval: 60          # Cache sync frequency (seconds)
```

## Usage

### From Python
```python
from mp_puzzle_generation.GeminiTaskProcessor import create_task_processor

# Create processor with multiprocessing
processor = create_task_processor(multiprocessing_enabled=True)

# Process themes
results, embeddings = processor.process_themes(themes, candidates_dict)
```

### From TypeScript
```bash
# Enable multiprocessing via command line
node generate-batch-gemini.ts --multiprocessing

# Or use default config setting
node generate-batch-gemini.ts
```

## Performance Benefits

### Parallelization
- Process multiple themes simultaneously
- Better API utilization (up to 2900 RPM)
- Scales with CPU cores

### Rate Limiting
- Maximizes API throughput
- Prevents API quota exhaustion
- Fair resource allocation

### Fault Tolerance
- Individual task failures don't stop pipeline
- Automatic retry logic
- Graceful error handling

### Progress Monitoring
- Real-time task completion tracking
- Performance metrics
- Worker statistics

## File Structure

```
mp_puzzle_generation/
├── __init__.py                 # Package initialization
├── README.md                   # This documentation
├── ThemeProcessingTask.py      # Task and result classes
├── ThemeWorker.py             # Worker process implementation
├── GeminiTaskProcessor.py     # Main orchestrator
├── RateLimiter.py            # Shared rate limiting
├── EmbeddingCacheManager.py   # Thread-safe cache
└── ResultAggregator.py        # Result collection and formatting
```

## Integration

The multiprocessing system integrates seamlessly with the existing pipeline:

1. **gemini_enhancer.py**: Updated to use task processor when `multiprocessing.enabled=true`
2. **generate-batch-gemini.ts**: Supports `--multiprocessing` flag
3. **params.yaml**: Configuration for worker count and rate limits
4. **Output format**: Compatible with existing Firebase conversion

## Monitoring

The system provides detailed statistics:
- Task processing rates
- API call counts and cache hits
- Worker utilization
- Rate limiter effectiveness
- Error rates and retry counts

## Error Handling

- **Task failures**: Individual tasks can fail without stopping the pipeline
- **Worker crashes**: Failed workers are detected and replaced
- **API errors**: Exponential backoff and retry logic
- **Cache corruption**: Backup and recovery mechanisms
- **Graceful shutdown**: Clean resource cleanup on interruption