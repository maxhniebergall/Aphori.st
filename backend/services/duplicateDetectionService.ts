import { VectorService } from './vectorService.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { 
    DuplicateDetectionResult, 
    DuplicateGroup, 
    DuplicateReplyData,
    DuplicateVotes,
    Reply
} from '../types/index.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import logger from '../logger.js';

const DEFAULT_SIMILARITY_THRESHOLD = 0.08; // Default distance threshold for duplicate detection (lower = more similar)
const MIN_SIMILARITY_FOR_DUPLICATE = 0.05; // Minimum distance threshold to consider for duplicates

export class DuplicateDetectionService {
    private vectorService: VectorService;
    private db: LoggedDatabaseClient;
    private similarityThreshold: number;

    constructor(vectorService: VectorService, db: LoggedDatabaseClient, similarityThreshold?: number) {
        this.vectorService = vectorService;
        this.db = db;
        this.similarityThreshold = similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD;
    }

    /**
     * Check if a reply is a duplicate of existing replies using vector similarity
     */
    async checkForDuplicates(reply: Reply, logContext?: any): Promise<DuplicateDetectionResult> {
        try {
            logger.info(logContext, 'Starting duplicate detection for reply', { replyId: reply.id });

            // Search for similar replies using vector similarity
            const searchResults = await this.vectorService.searchVectors(
                reply.text,
                10 // Search top 10 similar replies
            );

            logger.debug(logContext, 'Vector search results for duplicate detection', { 
                resultsCount: searchResults.length,
                threshold: this.similarityThreshold 
            });

            // Filter results by distance threshold and ensure we're not matching the same reply
            // Note: FAISS returns distance scores where lower values mean more similar
            // We check if distance is within threshold (0.08 means very similar)
            const duplicateCandidates = searchResults
                .filter(result => 
                    result.score <= this.similarityThreshold && // Lower distance = more similar
                    result.id !== reply.id &&
                    result.type === 'reply' // Only consider replies, not posts
                )
                .sort((a, b) => a.score - b.score); // Sort by distance ascending (most similar first)

            if (duplicateCandidates.length === 0) {
                logger.debug(logContext, 'No duplicate candidates found above threshold');
                return { isDuplicate: false };
            }

            // Find the best match (lowest distance = most similar)
            const bestMatch = duplicateCandidates[0];
            logger.info(logContext, 'Found potential duplicate', { 
                matchedReplyId: bestMatch.id,
                distance: bestMatch.score 
            });

            // Check if the matched reply is already part of a duplicate group
            const existingGroup = await this.findExistingDuplicateGroup(bestMatch.id);

            return {
                isDuplicate: true,
                duplicateGroup: existingGroup,
                similarityScore: bestMatch.score, // Store the distance as similarity score
                matchedReplyId: bestMatch.id
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(logContext, 'Error during duplicate detection', { error: errorMessage });
            // Return non-duplicate result on error to avoid blocking reply creation
            return { isDuplicate: false };
        }
    }

    /**
     * Create a new duplicate group with the original and duplicate reply
     */
    async createDuplicateGroup(originalReply: Reply, duplicateReply: Reply, similarityScore: number, logContext?: any): Promise<DuplicateGroup> {
        const groupId = this.generateCondensedUuid();
        
        logger.info(logContext, 'Creating new duplicate group', {
            groupId,
            originalReplyId: originalReply.id,
            duplicateReplyId: duplicateReply.id,
            similarityScore
        });

        const duplicateGroup: DuplicateGroup = {
            id: groupId,
            originalReplyId: originalReply.id,
            duplicateIds: [duplicateReply.id],
            createdAt: new Date().toISOString(),
            parentConnections: [originalReply.parentId, duplicateReply.parentId],
            threshold: this.similarityThreshold
        };

        // Create duplicate reply data
        const duplicateReplyData: DuplicateReplyData = {
            ...duplicateReply,
            parentType: duplicateReply.parentType || 'reply', // Use the reply's actual parent type
            duplicateGroupId: groupId,
            originalReplyId: originalReply.id,
            similarityScore,
            votes: this.createEmptyVotes(),
            parentConnections: [duplicateReply.parentId]
        };

        // Store using transaction to ensure consistency
        await this.db.createDuplicateGroupTransaction(duplicateGroup, originalReply.id, duplicateReplyData);

        logger.info(logContext, 'Successfully created duplicate group', { groupId });
        return duplicateGroup;
    }

    /**
     * Add a reply to an existing duplicate group
     */
    async addToDuplicateGroup(groupId: string, reply: Reply, similarityScore: number, logContext?: any): Promise<void> {
        logger.info(logContext, 'Adding reply to existing duplicate group', {
            groupId,
            replyId: reply.id,
            similarityScore
        });

        // Get existing group
        const existingGroup = await this.db.getDuplicateGroup(groupId);
        if (!existingGroup) {
            throw new Error(`Duplicate group ${groupId} not found`);
        }

        // Create duplicate reply data
        const duplicateReplyData: DuplicateReplyData = {
            ...reply,
            parentType: reply.parentType || 'reply', // Use the reply's actual parent type
            duplicateGroupId: groupId,
            originalReplyId: existingGroup.originalReplyId,
            similarityScore,
            votes: this.createEmptyVotes(),
            parentConnections: [reply.parentId]
        };

        // Update group data
        const updatedGroup: DuplicateGroup = {
            ...existingGroup,
            duplicateIds: [...existingGroup.duplicateIds, reply.id],
            parentConnections: [...new Set([...existingGroup.parentConnections, reply.parentId])] // Deduplicate
        };

        // Store duplicate reply and update group
        await this.db.setDuplicateReply(reply.id, duplicateReplyData);
        await this.db.setDuplicateGroup(groupId, updatedGroup);
        await this.db.addReplyToDuplicateGroup(groupId, reply.id);

        logger.info(logContext, 'Successfully added reply to duplicate group');
    }

    /**
     * Find if a reply is already part of a duplicate group
     */
    public async findExistingDuplicateGroup(replyId: string): Promise<DuplicateGroup | undefined> {
        // Check if this reply is a duplicate reply
        const duplicateReply = await this.db.getDuplicateReply(replyId);
        if (duplicateReply) {
            const group = await this.db.getDuplicateGroup(duplicateReply.duplicateGroupId);
            return group || undefined;
        }

        // Check if this reply is an original reply in any group
        // This is a more expensive operation, but necessary for completeness
        // In a production system, we might want to maintain a reverse index
        // For now, we'll assume most replies won't be originals of groups
        return undefined;
    }

    /**
     * Get duplicate group with all related replies
     */
    async getDuplicateGroupWithReplies(groupId: string): Promise<{
        group: DuplicateGroup;
        originalReply: Reply;
        duplicates: DuplicateReplyData[];
    } | null> {
        const group = await this.db.getDuplicateGroup(groupId);
        if (!group) {
            return null;
        }

        const originalReply = await this.db.getReply(group.originalReplyId);
        if (!originalReply) {
            logger.warn('Original reply not found for duplicate group', { groupId, originalReplyId: group.originalReplyId });
            return null;
        }

        const duplicates: DuplicateReplyData[] = [];
        for (const duplicateId of group.duplicateIds) {
            const duplicate = await this.db.getDuplicateReply(duplicateId);
            if (duplicate) {
                duplicates.push(duplicate);
            }
        }

        return { group, originalReply, duplicates };
    }

    /**
     * Update distance threshold for future detections
     */
    setSimilarityThreshold(threshold: number): void {
        if (threshold < MIN_SIMILARITY_FOR_DUPLICATE || threshold > 1.0) {
            throw new Error(`Distance threshold must be between ${MIN_SIMILARITY_FOR_DUPLICATE} and 1.0`);
        }
        this.similarityThreshold = threshold;
        logger.info('Updated distance threshold', { newThreshold: threshold });
    }

    /**
     * Get current distance threshold
     */
    getSimilarityThreshold(): number {
        return this.similarityThreshold;
    }

    private createEmptyVotes(): DuplicateVotes {
        return {
            upvotes: [],
            downvotes: [],
            totalScore: 0
        };
    }

    private generateCondensedUuid(): string {
        const uuidObj = uuidv7obj();
        const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
        return uuid25Instance.value;
    }
}