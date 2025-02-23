/**
 * Requirements:
 * - LRU cache implementation for Replies storage
 * - Memory-only caching with size limits
 * - Separate limits for stories and replies
 * - Cache invalidation strategy
 * - Type safety for all operations
 */

import { Reply } from '../types/types';

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
    private replyCache: LRUCache<Reply>;
    private batchCache: LRUCache<Reply[]>;

    private constructor() {
        this.replyCache = new LRUCache<Reply>(1000); // Limit to 1000 replies
        this.batchCache = new LRUCache<Reply[]>(50); // Limit to 50 batch results
    }

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    public get(key: string): Reply | null {
        return this.replyCache.get(key);
    }

    public set(key: string, value: Reply): void {
        this.replyCache.set(key, value);
    }

    public getBatch(key: string): Reply[] | null {
        return this.batchCache.get(key);
    }

    public setBatch(key: string, values: Reply[]): void {
        this.batchCache.set(key, values);
        // Also cache individual nodes
        values.forEach(node => this.set(node.id, node));
    }

    public clear(): void {
        this.replyCache.clear();
        this.batchCache.clear();
    }
}

export default CacheService; 