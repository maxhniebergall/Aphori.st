import { pino } from 'pino';
import { DatabaseClient, RedisSortedSetItem, FeedItem, Quote, Compressed } from '../types/index.js'; // Revert to using DatabaseClient type
// import { DatabaseClientInterface } from './DatabaseClientInterface.js'; // Remove direct interface import
import { LogContext, ReadOptions } from './loggingTypes.js';

export class LoggedDatabaseClient { // Remove implements DatabaseClientInterface
    private underlyingClient: DatabaseClient; // Revert type
    private logger: pino.Logger;

    constructor(client: DatabaseClient, loggerInstance: pino.Logger) { // Revert type
        this.underlyingClient = client;
        // Create a child logger specific to this component for better filtering
        this.logger = loggerInstance.child({ component: 'LoggedDatabaseClient' });
    }

    // Internal helper to create log payload
    private createLogPayload(operation: string, key: string | null, args: Record<string, any> | null, context?: LogContext) {
        return {
            db: {
                operation,
                ...(key && { key }), // Conditionally add key
                ...(args && { args }), // Conditionally add args
            },
            requestId: context?.requestId,
            operationId: context?.operationId,
        };
    }

    // --- Methods actively used and needing logging --- 

    // Mutations
    async hSet(key: string, field: string, value: any, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('hSet', key, { field, valueType: typeof value }, context);
        this.logger.debug(logPayload, 'Executing DB command: hSet');
        try {
            // Assuming underlyingClient.hSet returns Promise<number>
            return await this.underlyingClient.hSet(key, field, value, context);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: hSet');
            throw error;
        }
    }

    // Align zAdd signature: score: number, member: string based on linter feedback
    // Return Promise<number> assuming that matches DatabaseClient type for zAdd
    async zAdd(key: string, score: number, member: string, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('zAdd', key, { score, member }, context);
        this.logger.debug(logPayload, 'Executing DB command: zAdd');
        try {
            // Assuming underlying client returns Promise<number> now
            const result = await this.underlyingClient.zAdd(key, score, member);
            // Ensure the return type matches Promise<number>
            if (typeof result !== 'number') {
                this.logger.warn({...logPayload, actualReturn: typeof result}, 'DB command zAdd returned non-number, coercing or erroring might be needed');
                // Handle potential mismatch if underlying client *can* return string
                // Option 1: Throw error
                 throw new Error(`zAdd returned unexpected type: ${typeof result}`);
                // Option 2: Try to parse (if applicable)
                // return parseInt(result as string, 10);
                // Option 3: Return a default or indicator (less ideal)
                // return -1;
            }
            return result;
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: zAdd');
            throw error;
        }
    }

    // Align sAdd signature: member: string
    async sAdd(key: string, member: string, context?: LogContext): Promise<number> {
         const args = { memberType: typeof member };
         const logPayload = this.createLogPayload('sAdd', key, args, context);
         this.logger.debug(logPayload, 'Executing DB command: sAdd');
        try {
             return await this.underlyingClient.sAdd(key, member, context);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: sAdd');
            throw error;
        }
    }

    // Match signature used in routes/replies.ts (score can be number, member string)
    // Match return type used in routes/replies.ts (assuming Promise<number | string> is acceptable downstream)
    async hIncrementQuoteCount(key: string, field: string, quoteValue: Quote, context?: LogContext): Promise<number> {
         const logPayload = this.createLogPayload('hIncrementQuoteCount', key, { field, quoteId: quoteValue?.sourceId }, context);
         this.logger.debug(logPayload, 'Executing DB command: hIncrementQuoteCount');
         try {
             if (typeof this.underlyingClient.hIncrementQuoteCount !== 'function') {
                 throw new Error('hIncrementQuoteCount not implemented on the underlying client');
             }
             return await this.underlyingClient.hIncrementQuoteCount(key, field, quoteValue);
         } catch (error: any) {
             this.logger.error({ ...logPayload, err: error }, 'DB command failed: hIncrementQuoteCount');
             throw error;
         }
     }

    // Add lPush if used
    async lPush(key: string, element: string | string[], context?: LogContext): Promise<number> {
        const args = Array.isArray(element)
            ? { elementCount: element.length }
            : { elementType: typeof element };
        const logPayload = this.createLogPayload('lPush', key, args, context);
        this.logger.debug(logPayload, 'Executing DB command: lPush');
        try {
            return await this.underlyingClient.lPush(key, element, context);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: lPush');
            throw error;
        }
    }

    // Add other mutations (set, del, hIncrBy) if needed with similar pattern
    async set(key: string, value: any, context?: LogContext): Promise<string | null> {
        const logPayload = this.createLogPayload('set', key, { valueType: typeof value }, context);
        this.logger.debug(logPayload, 'Executing DB command: set');
        try { return await this.underlyingClient.set(key, value); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: set'); throw e; }
    }
    async del(key: string, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('del', key, null, context);
        this.logger.debug(logPayload, 'Executing DB command: del');
        try { return await this.underlyingClient.del(key); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: del'); throw e; }
    }
    async hIncrBy(key: string, field: string, increment: number, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('hIncrBy', key, { field, increment }, context);
        this.logger.debug(logPayload, 'Executing DB command: hIncrBy');
        try { return await this.underlyingClient.hIncrBy(key, field, increment); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: hIncrBy'); throw e; }
    }


    // Reads (with error logging)

    // Used in routes/replies.ts for quoteCounts
     async hGetAll(key: string, options?: ReadOptions, context?: LogContext): Promise<Record<string, any> | null> {
         try {
             // Assume underlying client returns Record<string, any> | null
             // The `as any` might be needed if the exact type is complex or uses generics incompatible here
             return await (this.underlyingClient as any).hGetAll(key, options);
        } catch (error: any) {
            this.logger.error({ ...this.createLogPayload('hGetAll', key, { options }, context), err: error }, 'DB read failed: hGetAll');
            throw error;
        }
    }

    // Used in routes/replies.ts for pagination count
    // Align return type with usage (number | null seems likely from RedisClient)
    async zCard(key: string, context?: LogContext): Promise<number | null> {
        try {
            // Allow null return based on potential Redis behavior
            return await this.underlyingClient.zCard(key);
        } catch (error: any) {
            this.logger.error({ ...this.createLogPayload('zCard', key, null, context), err: error }, 'DB read failed: zCard');
            throw error;
        }
    }

    // Used in routes/replies.ts to get reply data by ID
    async hGet(key: string, field: string, options?: ReadOptions, context?: LogContext): Promise<any> {
         try {
              // Use `as any` to bypass potential signature mismatches if options are involved
              return await (this.underlyingClient as any).hGet(key, field, options);
         } catch (error: any) {
             this.logger.error({ ...this.createLogPayload('hGet', key, { field, options }, context), err: error }, 'DB read failed: hGet');
             throw error;
         }
     }

     // Used for feed
     async lLen(key: string, context?: LogContext): Promise<number> {
        try {
            return await this.underlyingClient.lLen(key);
        } catch (error: any) {
            this.logger.error({ ...this.createLogPayload('lLen', key, null, context), err: error }, 'DB read failed: lLen');
            throw error;
        }
    }

    // Used for feed
     async lRange(key: string, start: number, stop: number, options?: ReadOptions, context?: LogContext): Promise<any[]> {
          try {
              return await (this.underlyingClient as any).lRange(key, start, stop, options);
         } catch (error: any) {
             this.logger.error({ ...this.createLogPayload('lRange', key, { start, stop, options }, context), err: error }, 'DB read failed: lRange');
             throw error;
         }
     }

    // Used for auth
    async get(key: string, context?: LogContext): Promise<any> {
        try {
            return await this.underlyingClient.get(key);
        } catch (error: any) {
            this.logger.error({ ...this.createLogPayload('get', key, null, context), err: error }, 'DB read failed: get');
            throw error;
        }
    }

    // Used for auth
    async sMembers(key: string, context?: LogContext): Promise<string[]> {
        try {
            return await this.underlyingClient.sMembers(key);
        } catch (error: any) {
            this.logger.error({ ...this.createLogPayload('sMembers', key, null, context), err: error }, 'DB read failed: sMembers');
            throw error;
        }
    }

    // Pass through getAllListItems
    async getAllListItems(key: string, context?: LogContext): Promise<any[]> {
        const logPayload = this.createLogPayload('getAllListItems', key, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getAllListItems');
        try {
            // Assume underlyingClient has the method (as it should implement the interface)
            return await (this.underlyingClient as any).getAllListItems(key);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: getAllListItems');
            throw error;
        }
    }

    // --- Passthrough methods --- 
    // Make isConnected/isReady async to match interface/promise return
    async connect(): Promise<void> { 
        if (typeof this.underlyingClient.connect === 'function') {
            return this.underlyingClient.connect(); 
        } // else void, implicitly returns undefined
    }
    async disconnect(): Promise<void> { 
        // Check if disconnect exists before calling
        if (typeof this.underlyingClient.disconnect === 'function') {
            return this.underlyingClient.disconnect(); 
        } // else void, implicitly returns undefined
    }
    async isConnected(): Promise<boolean> { 
        return typeof this.underlyingClient.isConnected === 'function' 
            ? await this.underlyingClient.isConnected() 
            : Promise.resolve(false); 
    }
    async isReady(): Promise<boolean> { 
        return typeof this.underlyingClient.isReady === 'function' 
            ? await this.underlyingClient.isReady() 
            : Promise.resolve(false); 
    }
    // Trust underlying signatures for compress/decompress/encodeKey
    async compress<T>(data: T): Promise<Compressed<T>> { 
        // Assuming compress exists and matches signature
        return this.underlyingClient.compress(data); 
    }
    async decompress<T>(data: Compressed<T>): Promise<T> { 
        // Use type assertion as a workaround for potential TS limitation
        return this.underlyingClient.decompress(data) as T; 
    }
    encodeKey(id: string, prefix?: string): string { 
        // Provide default empty string if prefix is undefined and underlying requires 2 args
        return this.underlyingClient.encodeKey(id, prefix ?? ''); 
    }

    // --- Methods NOT actively logged --- 
    // Passthrough using underlying client's signature
     async zRange(key: string, start: number | string, stop: number | string, options?: any): Promise<any[]> { 
         // Remove <T> if underlying is not generic 
         return (this.underlyingClient as any).zRange(key, start, stop, options); 
     }
     async zRevRangeByScore(key: string, max: number | string, min: number | string, options?: any): Promise<Array<string> | Array<RedisSortedSetItem<any>>> { 
         // Remove <T> if underlying is not generic
         return (this.underlyingClient as any).zRevRangeByScore(key, max, min, options); 
     }
     async zscan(key: string, cursor: string, options?: any): Promise<{ cursor: string; items: RedisSortedSetItem<any>[] }> { 
         return (this.underlyingClient as any).zscan(key, cursor, options); 
     }
     async keys(pattern: string): Promise<string[]> { return this.underlyingClient.keys(pattern); }
     async incrementFeedCounter(amount: number): Promise<void> { return this.underlyingClient.incrementFeedCounter(amount); }
     async getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> { return this.underlyingClient.getFeedItemsPage(limit, cursorKey); }

} 