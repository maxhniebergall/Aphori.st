import logger from './logger.js';
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';
import { Post, Reply } from './types/index.js';

export async function investigateVectorDiscrepancy(dbClient: LoggedDatabaseClient): Promise<void> {
    logger.info('Starting Vector Count Investigation...');
    
    try {
        // 1. Get database version
        const dbVersion = await dbClient.getDatabaseVersion();
        logger.info(`Current database version: ${JSON.stringify(dbVersion)}`);
        
        // 2. Get total posts and replies in database
        const postsData = await dbClient.getRawPath('posts');
        const posts: Post[] = postsData ? Object.values(postsData) : [];
        logger.info(`Total posts in database: ${posts.length}`);
        
        const repliesData = await dbClient.getRawPath('replies');
        const replies: Reply[] = repliesData ? Object.values(repliesData) : [];
        logger.info(`Total replies in database: ${replies.length}`);
        
        // 3. Get vector metadata
        const metadata = await (dbClient as any).getVectorIndexMetadata();
        if (metadata) {
            logger.info(`Vector metadata total count: ${metadata.totalVectorCount || 0}`);
            if (metadata.shards) {
                const shardKeys = Object.keys(metadata.shards);
                logger.info(`Number of shards: ${shardKeys.length}`);
                
                let actualVectorCount = 0;
                for (const shardKey of shardKeys) {
                    const shardPath = `vectorIndexStore/${shardKey}`;
                    const shardData = await dbClient.getRawPath(shardPath);
                    const shardVectorCount = shardData ? Object.keys(shardData).length : 0;
                    const metadataShardCount = metadata.shards[shardKey]?.count || 0;
                    
                    logger.info(`Shard ${shardKey}: metadata=${metadataShardCount}, actual=${shardVectorCount}`);
                    actualVectorCount += shardVectorCount;
                }
                
                logger.info(`SUMMARY:`);
                logger.info(`- Posts in database: ${posts.length}`);
                logger.info(`- Replies in database: ${replies.length}`);
                logger.info(`- Expected total content: ${posts.length + replies.length}`);
                logger.info(`- Metadata total vector count: ${metadata.totalVectorCount || 0}`);
                logger.info(`- Actual vectors in shards: ${actualVectorCount}`);
                
                const discrepancy = (metadata.totalVectorCount || 0) - actualVectorCount;
                if (discrepancy !== 0) {
                    logger.warn(`DISCREPANCY DETECTED: ${discrepancy} vectors missing from shards`);
                    
                    // 4. Check specific post/reply IDs to see which ones are missing vectors
                    const postIds = posts.map(p => p.id).filter(id => id);
                    const replyIds = replies.map(r => r.id).filter(id => id);
                    const allContentIds = [...postIds, ...replyIds];
                    
                    logger.info(`Checking vector existence for ${allContentIds.length} content items...`);
                    
                    const missingVectors: string[] = [];
                    const existingVectors: string[] = [];
                    
                    for (const contentId of allContentIds) {
                        const exists = await (dbClient as any).vectorExists(contentId);
                        if (exists) {
                            existingVectors.push(contentId);
                        } else {
                            missingVectors.push(contentId);
                        }
                    }
                    
                    logger.info(`Vector existence check results:`);
                    logger.info(`- Content items with vectors: ${existingVectors.length}`);
                    logger.info(`- Content items missing vectors: ${missingVectors.length}`);
                    
                    if (missingVectors.length > 0) {
                        logger.warn(`Missing vector IDs: ${missingVectors.slice(0, 20).join(', ')}${missingVectors.length > 20 ? '...' : ''}`);
                    }
                    
                    if (existingVectors.length !== actualVectorCount) {
                        logger.warn(`INCONSISTENCY: vectorExists() found ${existingVectors.length} but shard count is ${actualVectorCount}`);
                    }
                }
            }
        } else {
            logger.warn('No vector metadata found in database');
        }
        
    } catch (error: any) {
        logger.error('Error during investigation:', error);
    }
    
    logger.info('Vector Count Investigation completed.');
}