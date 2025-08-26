# 8-Thread Multiprocessing Configuration

This document explains the optimized configuration for 8-thread Gemini puzzle generation.

## Configuration Overview

### Worker Configuration
```yaml
multiprocessing:
  enabled: true
  worker_count: 8                    # 8 worker processes
  task_queue_size: 160              # 20 tasks per worker
  result_queue_size: 160            # 20 results per worker  
  max_concurrent_requests: 12       # 1.5 concurrent requests per worker
  cache_sync_interval: 45           # More frequent cache syncing
```

### Rate Limiting (Optimized for 8 Workers)
```yaml
gemini:
  requests_per_minute: 2880         # 360 RPM per worker (8 × 360 = 2880)
  min_request_interval: 0.05        # 50ms minimum between requests
  retry_base_delay: 0.8             # Faster retries for better throughput
  max_retries: 4                    # Fail faster to redistribute work
```

## Rationale

### 🎯 **Worker Count: 8**
- **CPU Utilization**: Optimal for 8-core systems (or 4-core with hyperthreading)
- **Memory Usage**: Each worker ~200MB, total ~1.6GB memory footprint
- **Task Distribution**: Good balance between parallelization and overhead

### 📦 **Queue Sizes: 160 each**
- **Task Queue**: 20 tasks per worker provides good buffering
- **Result Queue**: Prevents blocking when workers complete tasks quickly
- **Memory Overhead**: ~50MB for task queues (manageable)

### 🚦 **Concurrent Requests: 12**
- **API Efficiency**: 1.5 requests per worker allows batch processing
- **Rate Limit Safety**: Well under the 2880 RPM limit
- **Network Optimization**: Multiple concurrent connections improve throughput

### ⏱️ **Rate Limiting: 2880 RPM**
- **Per-Worker Allocation**: 360 RPM per worker (reasonable for theme processing)
- **API Tier Safety**: Stays under Tier 1 limit (3000 RPM) with buffer
- **Burst Handling**: Allows some workers to temporarily use more quota

### 🔄 **Cache Sync: 45 seconds**
- **Data Safety**: More frequent syncing with multiple writers
- **Performance**: Balance between safety and I/O overhead
- **Crash Recovery**: Minimizes data loss if processes crash

## Expected Performance

### 🏃‍♂️ **Throughput Estimates**
- **Sequential Processing**: ~1 theme per 3-5 seconds = 12-20 themes/minute
- **8-Worker Parallel**: ~8 themes per 3-5 seconds = 96-160 themes/minute
- **Speed Improvement**: 8x theoretical, ~6-7x practical (due to coordination overhead)

### 📊 **Resource Usage**
- **CPU**: 8 cores actively utilized
- **Memory**: ~1.6GB total (200MB per worker)
- **Network**: 12 concurrent connections to Gemini API
- **Disk I/O**: Cache writes every 45 seconds

### ⏲️ **Puzzle Generation Times**
- **80 puzzles (320 themes)**: ~3-5 minutes (vs 20-30 minutes sequential)
- **Cache Hit Rate**: Higher with parallel processing (shared cache)
- **API Quota**: Efficiently utilizes Tier 1 allowance

## Monitoring Commands

### Check Worker Status
```bash
# Monitor Python processes
ps aux | grep "ThemeWorker"

# Monitor memory usage
htop -p $(pgrep -f "ThemeWorker" | tr '\n' ',')
```

### Monitor API Usage
```bash
# Check rate limiter logs
tail -f logs/pipeline.log | grep "rate_limiter"

# Monitor queue sizes
tail -f logs/pipeline.log | grep "queue"
```

### Performance Metrics
```bash
# Check task completion rate
tail -f logs/pipeline.log | grep "Progress:"

# Monitor cache hit rate
tail -f logs/pipeline.log | grep "cache"
```

## Troubleshooting

### 🐌 **Slow Performance**
1. Check if all 8 workers are active: `ps aux | grep ThemeWorker`
2. Monitor API rate limiting: Look for "waiting" messages in logs
3. Check cache hit rate: Low hit rate means more API calls needed
4. Verify system resources: Ensure sufficient CPU/memory available

### 🚫 **API Errors**
1. **Quota Exceeded**: Reduce `requests_per_minute` to 2400
2. **Connection Errors**: Reduce `max_concurrent_requests` to 8
3. **Timeout Errors**: Increase `retry_base_delay` to 1.2

### 💾 **Memory Issues**
1. Reduce `worker_count` to 6
2. Reduce queue sizes to 120 each
3. Increase `cache_sync_interval` to 30 seconds

### 🔒 **File Lock Errors**
1. Check disk space and permissions
2. Reduce cache sync frequency
3. Monitor for crashed workers holding locks

## Advanced Tuning

### For Higher API Tiers
If you have Tier 2 (5000 RPM) or Tier 3 (10000 RPM):

```yaml
# Tier 2 Configuration
requests_per_minute: 4800          # 600 RPM per worker
max_concurrent_requests: 16        # 2 per worker

# Tier 3 Configuration  
requests_per_minute: 9600          # 1200 RPM per worker
max_concurrent_requests: 24        # 3 per worker
```

### For Lower-End Systems
If system has limited resources:

```yaml
worker_count: 4                    # Reduce workers
task_queue_size: 80               # 20 per worker
result_queue_size: 80
max_concurrent_requests: 6         # 1.5 per worker
requests_per_minute: 1440         # 360 per worker
```

This configuration provides optimal performance for 8-thread processing while maintaining stability and API compliance.