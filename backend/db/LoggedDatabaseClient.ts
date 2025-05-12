import { pino } from 'pino';
import { RedisSortedSetItem, Quote, Compressed } from '../types/index.js'; // Revert to using DatabaseClient type
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
// import { DatabaseClientInterface } from './DatabaseClientInterface.js'; // Remove direct interface import
import { LogContext, ReadOptions } from './loggingTypes.js';

export class LoggedDatabaseClient { // Remove implements DatabaseClientInterface
    private underlyingClient: DatabaseClientInterface; // Revert type
    private logger: pino.Logger;

    constructor(client: DatabaseClientInterface, loggerInstance: pino.Logger) { // Revert type
        this.underlyingClient = client;
        // Create a child logger specific to this component for better filtering
        this.logger = loggerInstance.child({ component: 'LoggedDatabaseClient' });
    }

    public getUnderlyingClient(): DatabaseClientInterface { 
        return this.underlyingClient;
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
        this.logger.info(logPayload, 'Executing DB command: hSet');
        try {
            // Assuming underlyingClient.hSet returns Promise<number>
            return await this.underlyingClient.hSet(key, field, value);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: hSet');
            throw error;
        }
    }

    // Align zAdd signature: score: number, member: string based on linter feedback
    // Return Promise<number> assuming that matches DatabaseClient type for zAdd
    async zAdd(key: string, score: number, member: string, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('zAdd', key, { score, member }, context);
        this.logger.info(logPayload, 'Executing DB command: zAdd');
        try {
            // Assuming underlying client returns Promise<number> now
            const result = await this.underlyingClient.zAdd(key, score, member);
            // Ensure the return type matches Promise<number>
            if (typeof result !== 'number') {
                this.logger.warn({...logPayload, actualReturn: typeof result}, 'DB command zAdd returned non-number, coercing or erroring might be needed');
                 throw new Error(`zAdd returned unexpected type: ${typeof result}`);
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
         this.logger.info(logPayload, 'Executing DB command: sAdd');
        try {
             return await this.underlyingClient.sAdd(key, member);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: sAdd');
            throw error;
        }
    }

    // Match signature used in routes/replies.ts (score can be number, member string)
    // Match return type used in routes/replies.ts (assuming Promise<number | string> is acceptable downstream)
    async hIncrementQuoteCount(key: string, field: string, quoteValue: Quote, context?: LogContext): Promise<number> {
         const logPayload = this.createLogPayload('hIncrementQuoteCount', key, { field, quoteId: quoteValue?.sourceId }, context);
         this.logger.info(logPayload, 'Executing DB command: hIncrementQuoteCount');
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
        this.logger.info(logPayload, 'Executing DB command: lPush');
        try {
            return await this.underlyingClient.lPush(key, element);
        } catch (error: any) {
            this.logger.error({ ...logPayload, err: error }, 'DB command failed: lPush');
            throw error;
        }
    }

    // Add other mutations (set, del, hIncrBy) if needed with similar pattern
    async set(key: string, value: any, context?: LogContext): Promise<string | null> {
        const logPayload = this.createLogPayload('set', key, { valueType: typeof value }, context);
        this.logger.info(logPayload, 'Executing DB command: set');
        try { return await this.underlyingClient.set(key, value); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: set'); throw e; }
    }
    async del(key: string, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('del', key, null, context);
        this.logger.info(logPayload, 'Executing DB command: del');
        try { return await this.underlyingClient.del(key); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: del'); throw e; }
    }
    async hIncrBy(key: string, field: string, increment: number, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('hIncrBy', key, { field, increment }, context);
        this.logger.info(logPayload, 'Executing DB command: hIncrBy');
        try { return await this.underlyingClient.hIncrBy(key, field, increment); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: hIncrBy'); throw e; }
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
            return await this.underlyingClient.getAllListItems(key);
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

    // --- Methods NOT actively logged --- 
    // Passthrough using underlying client's signature
     async keys(pattern: string): Promise<string[]> { return this.underlyingClient.keys(pattern); }
     async incrementFeedCounter(amount: number): Promise<void> { return this.underlyingClient.incrementFeedCounter(amount); }
     async getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> { return this.underlyingClient.getFeedItemsPage(limit, cursorKey); }

    // --- Semantic Methods: User Management ---
    async getUser(rawUserId: string): Promise<any | null> {
        const logPayload = this.createLogPayload('getUser', rawUserId, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getUser');
        return this.underlyingClient.getUser(rawUserId);
    }
    async getUserIdByEmail(rawEmail: string): Promise<string | null> {
        const logPayload = this.createLogPayload('getUserIdByEmail', rawEmail, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getUserIdByEmail');
        return this.underlyingClient.getUserIdByEmail(rawEmail);
    }
        async createUserProfile(rawUserId: string, rawEmail: string, context?: LogContext): Promise<{ success: boolean, error?: string, data?: any }> {
        const logPayload = this.createLogPayload('createUserProfile', rawUserId, { rawEmail }, context);
        this.logger.debug(logPayload, 'Executing DB command: createUserProfile');
        return this.underlyingClient.createUserProfile(rawUserId, rawEmail);
    }

    // --- Semantic Methods: Post Management ---
    async getPost(rawPostId: string): Promise<any | null> {
        const logPayload = this.createLogPayload('getPost', rawPostId, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getPost');
        return this.underlyingClient.getPost(rawPostId);
    }
    async setPost(rawPostId: string, postData: any): Promise<void> {
        const logPayload = this.createLogPayload('setPost', rawPostId, { postData }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: setPost');
        return this.underlyingClient.setPost(rawPostId, postData);
    }
    async addPostToGlobalSet(rawPostId: string): Promise<void> {
        const logPayload = this.createLogPayload('addPostToGlobalSet', rawPostId, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addPostToGlobalSet');
        return this.underlyingClient.addPostToGlobalSet(rawPostId);
    }
    async addPostToUserSet(rawUserId: string, rawPostId: string): Promise<void> {
        const logPayload = this.createLogPayload('addPostToUserSet', rawUserId, { rawPostId }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addPostToUserSet');
        return this.underlyingClient.addPostToUserSet(rawUserId, rawPostId);
    }
    async incrementPostReplyCounter(rawPostId: string, incrementAmount: number): Promise<number> {
        const logPayload = this.createLogPayload('incrementPostReplyCounter', rawPostId, { incrementAmount }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: incrementPostReplyCounter');
        return this.underlyingClient.incrementPostReplyCounter(rawPostId, incrementAmount);
    }
    async createPostTransaction(postData: any, feedItemData: any): Promise<void> {
        const logPayload = this.createLogPayload('createPostTransaction', null, { postData, feedItemData }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: createPostTransaction');
        return this.underlyingClient.createPostTransaction(postData, feedItemData);
    }

    // --- Semantic Methods: Reply Management ---
    async getReply(rawReplyId: string): Promise<any | null> {
        const logPayload = this.createLogPayload('getReply', rawReplyId, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getReply');
        return this.underlyingClient.getReply(rawReplyId);
    }
    async setReply(rawReplyId: string, replyData: any): Promise<void> {
        const logPayload = this.createLogPayload('setReply', rawReplyId, { replyData }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: setReply');
        return this.underlyingClient.setReply(rawReplyId, replyData);
    }
    async addReplyToUserSet(rawUserId: string, rawReplyId: string): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToUserSet', rawUserId, { rawReplyId }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addReplyToUserSet');
        return this.underlyingClient.addReplyToUserSet(rawUserId, rawReplyId);
    }
    async addReplyToParentRepliesIndex(rawParentId: string, rawReplyId: string): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToParentRepliesIndex', rawParentId, { rawReplyId }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addReplyToParentRepliesIndex');
        return this.underlyingClient.addReplyToParentRepliesIndex(rawParentId, rawReplyId);
    }
    async addReplyToRootPostRepliesIndex(rawRootPostId: string, rawReplyId: string): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToRootPostRepliesIndex', rawRootPostId, { rawReplyId }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addReplyToRootPostRepliesIndex');
        return this.underlyingClient.addReplyToRootPostRepliesIndex(rawRootPostId, rawReplyId);
    }
    async createReplyTransaction(replyData: any, hashedQuoteKey: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('createReplyTransaction', null, { replyData, hashedQuoteKey }, context);
        this.logger.debug(logPayload, 'Executing DB command: createReplyTransaction');
        return this.underlyingClient.createReplyTransaction(replyData, hashedQuoteKey);
    }

    // --- Semantic Methods: Feed Management / Indexing ---
    async addReplyToGlobalFeedIndex(rawReplyId: string, score: number, replyTeaserData?: any): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToGlobalFeedIndex', rawReplyId, { score, replyTeaserData }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addReplyToGlobalFeedIndex');
        return this.underlyingClient.addReplyToGlobalFeedIndex(rawReplyId, score, replyTeaserData);
    }
    async addReplyToParentQuoteIndex(rawParentId: string, rawHashedQuoteKey: string, rawReplyId: string, score: number): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToParentQuoteIndex', rawParentId, { rawHashedQuoteKey, rawReplyId, score }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addReplyToParentQuoteIndex');
        return this.underlyingClient.addReplyToParentQuoteIndex(rawParentId, rawHashedQuoteKey, rawReplyId, score);
    }
    async getReplyCountByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string): Promise<number> {
        const logPayload = this.createLogPayload('getReplyCountByParentQuote', rawParentId, { rawHashedQuoteKey, sortCriteria }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getReplyCountByParentQuote');
        return this.underlyingClient.getReplyCountByParentQuote(rawParentId, rawHashedQuoteKey, sortCriteria);
    }
    async getReplyIdsByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, limit: number, cursor?: string): Promise<{ items: Array<{ score: number, value: string }>, nextCursor: string | null }> {
        const logPayload = this.createLogPayload('getReplyIdsByParentQuote', rawParentId, { rawHashedQuoteKey, sortCriteria, limit, cursor }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getReplyIdsByParentQuote');
        return this.underlyingClient.getReplyIdsByParentQuote(rawParentId, rawHashedQuoteKey, sortCriteria, limit, cursor);
    }

    // --- Semantic Methods: Global Feed (List-like) ---
    async addPostToFeed(feedItemData: any): Promise<void> {
        const logPayload = this.createLogPayload('addPostToFeed', null, { feedItemData }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: addPostToFeed');
        return this.underlyingClient.addPostToFeed(feedItemData);
    }
    async getGlobalFeedItemCount(): Promise<number> {
        const logPayload = this.createLogPayload('getGlobalFeedItemCount', null, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getGlobalFeedItemCount');
        return this.underlyingClient.getGlobalFeedItemCount();
    }
    async incrementGlobalFeedCounter(amount: number): Promise<void> {
        const logPayload = this.createLogPayload('incrementGlobalFeedCounter', null, { amount }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: incrementGlobalFeedCounter');
        return this.underlyingClient.incrementGlobalFeedCounter(amount);
    }
    async getGlobalFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> {
        const logPayload = this.createLogPayload('getGlobalFeedItemsPage', null, { limit, cursorKey }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getGlobalFeedItemsPage');
        return this.underlyingClient.getGlobalFeedItemsPage(limit, cursorKey);
    }

    // --- Semantic Methods: Quote Management ---
    async incrementAndStoreQuoteUsage(rawParentId: string, rawHashedQuoteKey: string, quoteObject: any): Promise<number> {
        const logPayload = this.createLogPayload('incrementAndStoreQuoteUsage', rawParentId, { rawHashedQuoteKey, quoteObject }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: incrementAndStoreQuoteUsage');
        return this.underlyingClient.incrementAndStoreQuoteUsage(rawParentId, rawHashedQuoteKey, quoteObject);
    }
    async getQuoteCountsForParent(rawParentId: string): Promise<Record<string, { quote: any, count: number }> | null> {
        const logPayload = this.createLogPayload('getQuoteCountsForParent', rawParentId, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getQuoteCountsForParent');
        return this.underlyingClient.getQuoteCountsForParent(rawParentId);
    }

    // --- Semantic Methods: Low-Level Generic ---
    async getRawPath(path: string): Promise<any | null> {
        const logPayload = this.createLogPayload('getRawPath', path, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: getRawPath');
        return this.underlyingClient.getRawPath(path);
    }
    async setRawPath(path: string, value: any): Promise<void> {
        const logPayload = this.createLogPayload('setRawPath', path, { value }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: setRawPath');
        return this.underlyingClient.setRawPath(path, value);
    }
    async updateRawPaths(updates: Record<string, any>): Promise<void> {
        const logPayload = this.createLogPayload('updateRawPaths', null, { updates }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: updateRawPaths');
        return this.underlyingClient.updateRawPaths(updates);
    }
    async removeRawPath(path: string): Promise<void> {
        const logPayload = this.createLogPayload('removeRawPath', path, null, undefined);
        this.logger.debug(logPayload, 'Executing DB command: removeRawPath');
        return this.underlyingClient.removeRawPath(path);
    }
    async runTransaction(path: string, transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean, snapshot: any | null }> {
        const logPayload = this.createLogPayload('runTransaction', path, { transactionUpdate: 'function' }, undefined);
        this.logger.debug(logPayload, 'Executing DB command: runTransaction');
        return this.underlyingClient.runTransaction(path, transactionUpdate);
    }
} 