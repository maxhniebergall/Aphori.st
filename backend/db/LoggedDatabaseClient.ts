import type { Logger } from 'pino';   // type-only import
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { LogContext } from './loggingTypes.js';
import { FirebaseClient } from './FirebaseClient.js';
import { VectorIndexMetadata, VectorIndexEntry, VectorDataForFaiss } from '../types/index.js';

export class LoggedDatabaseClient implements DatabaseClientInterface { 
    private underlyingClient: DatabaseClientInterface; 
    private logger: Logger;

    constructor(client: DatabaseClientInterface, loggerInstance: Logger) { 
        this.underlyingClient = client;
        this.logger = loggerInstance.child({ component: 'LoggedDatabaseClient' });
    }


   

    public getUnderlyingClient(): DatabaseClientInterface { 
        return this.underlyingClient;
    }

    public unescapeFirebaseKeyPercentEncoding(key: string): string | null {
        if (this.underlyingClient instanceof FirebaseClient) {
            return this.underlyingClient.unescapeFirebaseKeyPercentEncoding(key);
        }
        this.logger.warn('Attempted to use unescapeFirebaseKeyPercentEncoding when underlying client is not FirebaseClient.');
        return null; // Or throw error
    }

    // Internal helper to create log payload
    private createLogPayload(operation: string, keyOrPath: string | null, args: Record<string, any> | null, context?: LogContext) {
        return {
            db: {
                operation,
                ...(keyOrPath && { keyOrPath }), // Renamed for clarity
                ...(args && { args }),
            },
            requestId: context?.requestId,
            operationId: context?.operationId,
        };
    }

    // --- Connection Status --- 
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

    // --- Semantic Methods: User Management ---
    async getUser(rawUserId: string, context?: LogContext): Promise<any | null> {
        const logPayload = this.createLogPayload('getUser', rawUserId, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getUser'); // READ = debug
        try { return this.underlyingClient.getUser(rawUserId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getUser'); throw e; }
    }
    async getUserIdByEmail(rawEmail: string, context?: LogContext): Promise<string | null> {
        const logPayload = this.createLogPayload('getUserIdByEmail', rawEmail, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getUserIdByEmail'); // READ = debug
        try { return this.underlyingClient.getUserIdByEmail(rawEmail); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getUserIdByEmail'); throw e; }
    }
    async createUserProfile(rawUserId: string, rawEmail: string, context?: LogContext): Promise<{ success: boolean, error?: string, data?: any }> {
        const logPayload = this.createLogPayload('createUserProfile', rawUserId, { rawEmail }, context);
        this.logger.info(logPayload, 'Executing DB command: createUserProfile'); // WRITE = info
        try { return this.underlyingClient.createUserProfile(rawUserId, rawEmail); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: createUserProfile'); throw e; }
    }
    async setUserDataForMigration(rawUserId: string, data: any, context?: LogContext): Promise<void> { // Renamed + Context added
        const logPayload = this.createLogPayload('setUserDataForMigration', rawUserId, { dataType: typeof data }, context);
        this.logger.info(logPayload, 'Executing DB command: setUserDataForMigration'); // WRITE = info
        try { return await this.underlyingClient.setUserDataForMigration(rawUserId, data); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setUserDataForMigration'); throw e; }
    }
    async addUserToCatalog(rawUserId: string, context?: LogContext): Promise<void> { // Context added
        const logPayload = this.createLogPayload('addUserToCatalog', rawUserId, null, context);
        this.logger.info(logPayload, 'Executing DB command: addUserToCatalog'); // WRITE = info
        try { return await this.underlyingClient.addUserToCatalog(rawUserId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addUserToCatalog'); throw e; }
    }
    async setEmailToIdMapping(rawEmail: string, rawUserId: string, context?: LogContext): Promise<void> { // Context added
        const logPayload = this.createLogPayload('setEmailToIdMapping', rawEmail, { rawUserId }, context);
        this.logger.info(logPayload, 'Executing DB command: setEmailToIdMapping'); // WRITE = info
        try { return await this.underlyingClient.setEmailToIdMapping(rawEmail, rawUserId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setEmailToIdMapping'); throw e; }
    }
    async getAllUsers(context?: LogContext): Promise<Record<string, any> | null> { // Context added
        const logPayload = this.createLogPayload('getAllUsers', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getAllUsers'); // READ = debug
        try { return await this.underlyingClient.getAllUsers(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getAllUsers'); throw e; }
    }

    // --- Semantic Methods: Post Management ---
    async getPost(rawPostId: string, context?: LogContext): Promise<any | null> {
        const logPayload = this.createLogPayload('getPost', rawPostId, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getPost'); // READ = debug
        try { return this.underlyingClient.getPost(rawPostId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getPost'); throw e; }
    }
    async setPost(rawPostId: string, postData: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('setPost', rawPostId, { postData }, context);
        this.logger.info(logPayload, 'Executing DB command: setPost'); // WRITE = info
        try { return this.underlyingClient.setPost(rawPostId, postData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setPost'); throw e; }
    }
    async addPostToGlobalSet(rawPostId: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addPostToGlobalSet', rawPostId, null, context);
        this.logger.info(logPayload, 'Executing DB command: addPostToGlobalSet'); // WRITE = info
        try { return this.underlyingClient.addPostToGlobalSet(rawPostId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addPostToGlobalSet'); throw e; }
    }
    async addPostToUserSet(rawUserId: string, rawPostId: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addPostToUserSet', rawUserId, { rawPostId }, context);
        this.logger.info(logPayload, 'Executing DB command: addPostToUserSet'); // WRITE = info
        try { return this.underlyingClient.addPostToUserSet(rawUserId, rawPostId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addPostToUserSet'); throw e; }
    }
    async incrementPostReplyCounter(rawPostId: string, incrementAmount: number, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('incrementPostReplyCounter', rawPostId, { incrementAmount }, context);
        this.logger.info(logPayload, 'Executing DB command: incrementPostReplyCounter'); // WRITE = info
        try { return this.underlyingClient.incrementPostReplyCounter(rawPostId, incrementAmount); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: incrementPostReplyCounter'); throw e; }
    }
    async createPostTransaction(postData: any, feedItemData: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('createPostTransaction', null, { postData, feedItemData }, context);
        this.logger.info(logPayload, 'Executing DB command: createPostTransaction'); // WRITE = info
        try { return this.underlyingClient.createPostTransaction(postData, feedItemData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: createPostTransaction'); throw e; }
    }

    // --- Semantic Methods: Reply Management ---
    async getReply(rawReplyId: string, context?: LogContext): Promise<any | null> {
        const logPayload = this.createLogPayload('getReply', rawReplyId, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getReply'); // READ = debug
        try { return this.underlyingClient.getReply(rawReplyId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getReply'); throw e; }
    }
    async setReply(rawReplyId: string, replyData: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('setReply', rawReplyId, { replyData }, context);
        this.logger.info(logPayload, 'Executing DB command: setReply'); // WRITE = info
        try { return this.underlyingClient.setReply(rawReplyId, replyData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setReply'); throw e; }
    }
    async addReplyToUserSet(rawUserId: string, rawReplyId: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToUserSet', rawUserId, { rawReplyId }, context);
        this.logger.info(logPayload, 'Executing DB command: addReplyToUserSet'); // WRITE = info
        try { return this.underlyingClient.addReplyToUserSet(rawUserId, rawReplyId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addReplyToUserSet'); throw e; }
    }
    async addReplyToParentRepliesIndex(rawParentId: string, rawReplyId: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToParentRepliesIndex', rawParentId, { rawReplyId }, context);
        this.logger.info(logPayload, 'Executing DB command: addReplyToParentRepliesIndex'); // WRITE = info
        try { return this.underlyingClient.addReplyToParentRepliesIndex(rawParentId, rawReplyId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addReplyToParentRepliesIndex'); throw e; }
    }
    async addReplyToRootPostRepliesIndex(rawRootPostId: string, rawReplyId: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToRootPostRepliesIndex', rawRootPostId, { rawReplyId }, context);
        this.logger.info(logPayload, 'Executing DB command: addReplyToRootPostRepliesIndex'); // WRITE = info
        try { return this.underlyingClient.addReplyToRootPostRepliesIndex(rawRootPostId, rawReplyId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addReplyToRootPostRepliesIndex'); throw e; }
    }
    async createReplyTransaction(replyData: any, hashedQuoteKey: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('createReplyTransaction', null, { replyData, hashedQuoteKey }, context);
        this.logger.info(logPayload, 'Executing DB command: createReplyTransaction'); // WRITE = info
        try { return this.underlyingClient.createReplyTransaction(replyData, hashedQuoteKey); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: createReplyTransaction'); throw e; }
    }

    // --- Semantic Methods: Feed Management / Indexing ---
    async addReplyToGlobalFeedIndex(rawReplyId: string, score: number, replyTeaserData?: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToGlobalFeedIndex', rawReplyId, { score, replyTeaserData }, context);
        this.logger.info(logPayload, 'Executing DB command: addReplyToGlobalFeedIndex'); // WRITE = info
        try { return this.underlyingClient.addReplyToGlobalFeedIndex(rawReplyId, score, replyTeaserData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addReplyToGlobalFeedIndex'); throw e; }
    }
    async addReplyToParentQuoteIndex(rawParentId: string, rawHashedQuoteKey: string, rawReplyId: string, score: number, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addReplyToParentQuoteIndex', rawParentId, { rawHashedQuoteKey, rawReplyId, score }, context);
        this.logger.info(logPayload, 'Executing DB command: addReplyToParentQuoteIndex'); // WRITE = info
        try { return this.underlyingClient.addReplyToParentQuoteIndex(rawParentId, rawHashedQuoteKey, rawReplyId, score); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addReplyToParentQuoteIndex'); throw e; }
    }
    async getReplyCountByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('getReplyCountByParentQuote', rawParentId, { rawHashedQuoteKey, sortCriteria }, context);
        this.logger.debug(logPayload, 'Executing DB command: getReplyCountByParentQuote'); // READ = debug
        try { return this.underlyingClient.getReplyCountByParentQuote(rawParentId, rawHashedQuoteKey, sortCriteria); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getReplyCountByParentQuote'); throw e; }
    }
    async getReplyIdsByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, limit: number, cursor?: string, context?: LogContext): Promise<{ items: Array<{ score: number, value: string }>, nextCursor: string | null }> {
        const logPayload = this.createLogPayload('getReplyIdsByParentQuote', rawParentId, { rawHashedQuoteKey, sortCriteria, limit, cursor }, context);
        this.logger.debug(logPayload, 'Executing DB command: getReplyIdsByParentQuote'); // READ = debug
        try { return this.underlyingClient.getReplyIdsByParentQuote(rawParentId, rawHashedQuoteKey, sortCriteria, limit, cursor); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getReplyIdsByParentQuote'); throw e; }
    }

    // --- Semantic Methods: Global Feed (List-like) ---
    async addPostToFeed(feedItemData: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addPostToFeed', null, { feedItemData }, context);
        this.logger.info(logPayload, 'Executing DB command: addPostToFeed'); // WRITE = info
        try { return this.underlyingClient.addPostToFeed(feedItemData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addPostToFeed'); throw e; }
    }
    async getGlobalFeedItemCount(context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('getGlobalFeedItemCount', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getGlobalFeedItemCount'); // READ = debug
        try { return this.underlyingClient.getGlobalFeedItemCount(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getGlobalFeedItemCount'); throw e; }
    }
    async incrementFeedCounter(amount: number, context?: LogContext): Promise<void> { 
        const logPayload = this.createLogPayload('incrementFeedCounter', null, { amount }, context);
        this.logger.info(logPayload, 'Executing DB command: incrementFeedCounter'); // WRITE = info
        try { return await this.underlyingClient.incrementFeedCounter(amount); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: incrementFeedCounter'); throw e; }
    }
    async getFeedItemsPage(limit: number, cursorKey?: string, context?: LogContext): Promise<{ items: any[], nextCursorKey: string | null }> { 
        const logPayload = this.createLogPayload('getFeedItemsPage', null, { limit, cursorKey }, context);
        this.logger.debug(logPayload, 'Executing DB command: getFeedItemsPage'); // READ = debug
        try { return await this.underlyingClient.getFeedItemsPage(limit, cursorKey); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getFeedItemsPage'); throw e; }
    }

    // --- Semantic Methods: Quote Management ---    
    async incrementAndStoreQuoteUsage(rawParentId: string, rawHashedQuoteKey: string, quoteObject: any, context?: LogContext): Promise<number> {
        const logPayload = this.createLogPayload('incrementAndStoreQuoteUsage', rawParentId, { rawHashedQuoteKey, quoteObject }, context);
        this.logger.info(logPayload, 'Executing DB command: incrementAndStoreQuoteUsage'); // WRITE = info
        try { return this.underlyingClient.incrementAndStoreQuoteUsage(rawParentId, rawHashedQuoteKey, quoteObject); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: incrementAndStoreQuoteUsage'); throw e; }
    }
    async getQuoteCountsForParent(rawParentId: string, context?: LogContext): Promise<Record<string, { quote: any, count: number }> | null> {
        const logPayload = this.createLogPayload('getQuoteCountsForParent', rawParentId, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getQuoteCountsForParent'); // READ = debug
        try { return this.underlyingClient.getQuoteCountsForParent(rawParentId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getQuoteCountsForParent'); throw e; }
    }

    // --- Semantic Methods: Startup Mailer ---
    async addProcessedStartupEmail(rawEmail: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addProcessedStartupEmail', rawEmail, null, context);
        this.logger.info(logPayload, 'Executing DB command: addProcessedStartupEmail'); // WRITE = info
        try { return await this.underlyingClient.addProcessedStartupEmail(rawEmail); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addProcessedStartupEmail'); throw e; }
    }
    async getMailerVersion(context?: LogContext): Promise<string | null> {
        const logPayload = this.createLogPayload('getMailerVersion', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getMailerVersion'); // READ = debug
        try { return await this.underlyingClient.getMailerVersion(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getMailerVersion'); throw e; }
    }
    async setMailerVersion(version: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('setMailerVersion', null, { version }, context);
        this.logger.info(logPayload, 'Executing DB command: setMailerVersion'); // WRITE = info
        try { return await this.underlyingClient.setMailerVersion(version); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setMailerVersion'); throw e; }
    }
    async getMailSentListMap(context?: LogContext): Promise<Record<string, any> | null> {
        const logPayload = this.createLogPayload('getMailSentListMap', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getMailSentListMap'); // READ = debug
        try { return await this.underlyingClient.getMailSentListMap(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getMailSentListMap'); throw e; }
    }
    async initializeMailSentList(context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('initializeMailSentList', null, null, context);
        this.logger.info(logPayload, 'Executing DB command: initializeMailSentList'); // WRITE = info
        try { return await this.underlyingClient.initializeMailSentList(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: initializeMailSentList'); throw e; }
    }
    async clearMailSentList(context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('clearMailSentList', null, null, context);
        this.logger.info(logPayload, 'Executing DB command: clearMailSentList'); // WRITE = info
        try { return await this.underlyingClient.clearMailSentList(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: clearMailSentList'); throw e; }
    }

    // --- Semantic Methods: Migration Specific ---
    async getDatabaseVersion(context?: LogContext): Promise<any | null> {
        const logPayload = this.createLogPayload('getDatabaseVersion', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getDatabaseVersion'); // READ = debug
        try { return await this.underlyingClient.getDatabaseVersion(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getDatabaseVersion'); throw e; }
    }
    async setDatabaseVersion(versionData: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('setDatabaseVersion', null, { versionDataType: typeof versionData }, context);
        this.logger.info(logPayload, 'Executing DB command: setDatabaseVersion'); // WRITE = info
        try { return await this.underlyingClient.setDatabaseVersion(versionData); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setDatabaseVersion'); throw e; }
    }
    async deleteOldEmailToIdKey(oldKey: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('deleteOldEmailToIdKey', oldKey, null, context);
        this.logger.info(logPayload, 'Executing DB command: deleteOldEmailToIdKey'); // WRITE = info
        try { return await this.underlyingClient.deleteOldEmailToIdKey(oldKey); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: deleteOldEmailToIdKey'); throw e; }
    }

    // --- Semantic Methods: Low-Level Generic ---
    async getRawPath(path: string, context?: LogContext): Promise<any | null> {
        const logPayload = this.createLogPayload('getRawPath', path, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getRawPath'); // READ = debug
        try { return this.underlyingClient.getRawPath(path); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getRawPath'); throw e; }
    }
    async setRawPath(path: string, value: any, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('setRawPath', path, { valueType: typeof value }, context);
        this.logger.info(logPayload, 'Executing DB command: setRawPath'); // WRITE = info
        try { return this.underlyingClient.setRawPath(path, value); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: setRawPath'); throw e; }
    }
    async updateRawPaths(updates: Record<string, any>, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('updateRawPaths', null, { updateCount: Object.keys(updates).length }, context);
        this.logger.info(logPayload, 'Executing DB command: updateRawPaths'); // WRITE = info
        try { return this.underlyingClient.updateRawPaths(updates); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: updateRawPaths'); throw e; }
    }
    async removeRawPath(path: string, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('removeRawPath', path, null, context);
        this.logger.info(logPayload, 'Executing DB command: removeRawPath'); // WRITE = info
        try { return this.underlyingClient.removeRawPath(path); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: removeRawPath'); throw e; }
    }
    async runTransaction(path: string, transactionUpdate: (currentData: any) => any, context?: LogContext): Promise<{ committed: boolean, snapshot: any | null }> {
        const logPayload = this.createLogPayload('runTransaction', path, { transactionUpdate: 'function' }, context);
        this.logger.info(logPayload, 'Executing DB command: runTransaction'); // WRITE = info
        try { return this.underlyingClient.runTransaction(path, transactionUpdate); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: runTransaction'); throw e; }
    }

    // --- Vector Search Methods (FirebaseClient specific) ---
    async getVectorIndexMetadata(context?: LogContext): Promise<VectorIndexMetadata | null> {
        const logPayload = this.createLogPayload('getVectorIndexMetadata', null, null, context);
        this.logger.debug(logPayload, 'Executing DB command: getVectorIndexMetadata'); // READ = debug
        try { return (this.underlyingClient as any).getVectorIndexMetadata(); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getVectorIndexMetadata'); throw e; }
    }

    async getAllVectorsFromShards(shardKeys: string[], faissIndexLimit: number, context?: LogContext): Promise<VectorDataForFaiss[]> {
        const logPayload = this.createLogPayload('getAllVectorsFromShards', null, { shardKeys, faissIndexLimit }, context);
        this.logger.debug(logPayload, 'Executing DB command: getAllVectorsFromShards'); // READ = debug
        try { return (this.underlyingClient as any).getAllVectorsFromShards(shardKeys, faissIndexLimit); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getAllVectorsFromShards'); throw e; }
    }

    async vectorExists(rawContentId: string, context?: LogContext): Promise<boolean> {
        const logPayload = this.createLogPayload('vectorExists', rawContentId, null, context);
        this.logger.debug(logPayload, 'Executing DB command: vectorExists'); // READ = debug
        try { return (this.underlyingClient as any).vectorExists(rawContentId); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: vectorExists'); throw e; }
    }

    async addVectorToShardStore(rawContentId: string, vectorEntry: VectorIndexEntry, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('addVectorToShardStore', rawContentId, { vectorEntry }, context);
        this.logger.info(logPayload, 'Executing DB command: addVectorToShardStore'); // WRITE = info
        try { return (this.underlyingClient as any).addVectorToShardStore(rawContentId, vectorEntry); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: addVectorToShardStore'); throw e; }
    }

    // Add missing Global Feed methods from interface
    async incrementGlobalFeedCounter(amount: number, context?: LogContext): Promise<void> {
        const logPayload = this.createLogPayload('incrementGlobalFeedCounter', null, { amount }, context);
        this.logger.info(logPayload, 'Executing DB command: incrementGlobalFeedCounter'); // WRITE = info
        try { return await this.underlyingClient.incrementGlobalFeedCounter(amount); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: incrementGlobalFeedCounter'); throw e; }
    }
    async getGlobalFeedItemsPage(limit: number, cursorKey?: string, context?: LogContext): Promise<{ items: any[], nextCursorKey: string | null }> {
        const logPayload = this.createLogPayload('getGlobalFeedItemsPage', null, { limit, cursorKey }, context);
        this.logger.debug(logPayload, 'Executing DB command: getGlobalFeedItemsPage'); // READ = debug
        try { return await this.underlyingClient.getGlobalFeedItemsPage(limit, cursorKey); } catch (e: any) { this.logger.error({ ...logPayload, err: e}, 'Cmd Failed: getGlobalFeedItemsPage'); throw e; }
    }
} 