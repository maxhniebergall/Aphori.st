/**
 * Requirements:
 * - LRU cache implementation for UnifiedNode storage
 * - Memory-only caching with size limits
 * - Separate limits for stories and replies
 * - Cache invalidation strategy
 * - Type safety for all operations
 */

import { UnifiedNode } from '../context/types';

class LRUCache<T> {
    private capacity: number;
    private cache: Map<string, T>;
    private usage: Map<string, number>;
    private time: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.cache = new Map();
        this.usage = new Map();
        this.time = 0;
    }

    get(key: string): T | null {
        if (!this.cache.has(key)) return null;
        this.usage.set(key, ++this.time);
        return this.cache.get(key)!;
    }

    set(key: string, value: T): void {
        if (this.cache.size >= this.capacity && !this.cache.has(key)) {
            // Find least recently used
            let lruKey = '';
            let lruTime = Infinity;
            this.usage.forEach((time, k) => {
                if (time < lruTime) {
                    lruKey = k;
                    lruTime = time;
                }
            });
            this.cache.delete(lruKey);
            this.usage.delete(lruKey);
        }
        this.cache.set(key, value);
        this.usage.set(key, ++this.time);
    }

    clear(): void {
        this.cache.clear();
        this.usage.clear();
        this.time = 0;
    }

    size(): number {
        return this.cache.size;
    }
}

export class CacheService {
    private static instance: CacheService;
    private storyCache: LRUCache<UnifiedNode>;
    private replyCache: LRUCache<UnifiedNode>;
    private batchCache: LRUCache<UnifiedNode[]>;

    private constructor() {
        this.storyCache = new LRUCache<UnifiedNode>(100); // Limit to 100 stories
        this.replyCache = new LRUCache<UnifiedNode>(1000); // Limit to 1000 replies
        this.batchCache = new LRUCache<UnifiedNode[]>(50); // Limit to 50 batch results
    }

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    public get(key: string): UnifiedNode | null {
        const nodeType = this.getNodeType(key);
        return nodeType === 'story' 
            ? this.storyCache.get(key)
            : this.replyCache.get(key);
    }

    public set(key: string, value: UnifiedNode): void {
        const nodeType = this.getNodeType(key);
        if (nodeType === 'story') {
            this.storyCache.set(key, value);
        } else {
            this.replyCache.set(key, value);
        }
    }

    public getBatch(key: string): UnifiedNode[] | null {
        return this.batchCache.get(key);
    }

    public setBatch(key: string, values: UnifiedNode[]): void {
        this.batchCache.set(key, values);
        // Also cache individual nodes
        values.forEach(node => this.set(node.id, node));
    }

    public clear(): void {
        this.storyCache.clear();
        this.replyCache.clear();
        this.batchCache.clear();
    }

    private getNodeType(key: string): 'story' | 'reply' {
        return key.startsWith('story:') ? 'story' : 'reply';
    }
}

export default CacheService; 