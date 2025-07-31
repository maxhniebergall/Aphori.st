import React from 'react';
import { DuplicateGroup, DuplicateReply, Reply } from '../types/types';
import DuplicateVotingPanel from './DuplicateVotingPanel';
import './DuplicateComparisonView.css';

interface DuplicateComparisonViewProps {
    originalReply: Reply;
    duplicates: DuplicateReply[];
    group: DuplicateGroup;
    onVote: (replyId: string) => void;
}

const DuplicateComparisonView: React.FC<DuplicateComparisonViewProps> = ({
    originalReply,
    duplicates,
    group,
    onVote
}) => {
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const formatSimilarity = (score: number) => {
        return `${(score * 100).toFixed(1)}%`;
    };

    return (
        <div className="duplicate-comparison-view">
            <div className="comparison-grid">
                {/* Original Reply */}
                <div className="reply-card original-reply">
                    <div className="reply-header">
                        <h3>Original Reply</h3>
                        <div className="reply-meta">
                            <span className="author">by {originalReply.authorId}</span>
                            <span className="date">{formatDate(originalReply.createdAt)}</span>
                        </div>
                    </div>
                    
                    <div className="reply-content">
                        <div className="quoted-text">
                            <h4>Quoted text:</h4>
                            <blockquote>{originalReply.quote.text}</blockquote>
                        </div>
                        
                        <div className="reply-text">
                            <h4>Reply:</h4>
                            <p>{originalReply.text}</p>
                        </div>
                    </div>
                </div>

                {/* Duplicate Replies */}
                {duplicates.map((duplicate, index) => (
                    <div key={duplicate.id} className="reply-card duplicate-reply">
                        <div className="reply-header">
                            <h3>Duplicate Reply #{index + 1}</h3>
                            <div className="reply-meta">
                                <span className="author">by {duplicate.authorId}</span>
                                <span className="date">{formatDate(duplicate.createdAt)}</span>
                                <span className="similarity">
                                    {formatSimilarity(duplicate.similarityScore)} similar
                                </span>
                            </div>
                        </div>
                        
                        <div className="reply-content">
                            <div className="quoted-text">
                                <h4>Quoted text:</h4>
                                <blockquote>{duplicate.quote.text}</blockquote>
                            </div>
                            
                            <div className="reply-text">
                                <h4>Reply:</h4>
                                <p>{duplicate.text}</p>
                            </div>
                        </div>

                        <DuplicateVotingPanel
                            replyId={duplicate.id}
                            votes={duplicate.votes}
                            onVote={() => onVote(duplicate.id)}
                        />
                    </div>
                ))}
            </div>

            <div className="group-info">
                <h3>Group Information</h3>
                <div className="group-details">
                    <p><strong>Group ID:</strong> {group.id}</p>
                    <p><strong>Created:</strong> {formatDate(group.createdAt)}</p>
                    <p><strong>Similarity Threshold:</strong> {formatSimilarity(group.threshold)}</p>
                    <p><strong>Total Duplicates:</strong> {duplicates.length}</p>
                    <p><strong>Parent Connections:</strong> {group.parentConnections.length} different discussions</p>
                </div>
            </div>
        </div>
    );
};

export default DuplicateComparisonView;