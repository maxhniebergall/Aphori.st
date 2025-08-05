import React from 'react';
import { DuplicateVotes } from '../types/types';
import './DuplicateVotingPanel.css';

interface DuplicateVotingPanelProps {
    replyId: string;
    votes: DuplicateVotes;
    onVote: () => void;
    currentUserId?: string;
}

const DuplicateVotingPanel: React.FC<DuplicateVotingPanelProps> = ({
    votes,
    onVote,
    currentUserId
}) => {
    const totalVotes = votes.upvotes.length + votes.downvotes.length;
    const upvotePercentage = totalVotes > 0 ? (votes.upvotes.length / totalVotes) * 100 : 0;
    
    return (
        <div className="duplicate-voting-panel">
            <div className="voting-header">
                <h4>Community Preference</h4>
                <span className="total-score">Score: {votes.totalScore}</span>
            </div>
            
            <div className="vote-stats">
                <div className="vote-bar">
                    <div 
                        className="upvote-bar" 
                        style={{ width: `${upvotePercentage}%` }}
                    ></div>
                </div>
                <div className="vote-counts">
                    <span className="upvotes">👍 {votes.upvotes.length}</span>
                    <span className="downvotes">👎 {votes.downvotes.length}</span>
                </div>
            </div>

            <button 
                className="vote-button"
                onClick={onVote}
                disabled={false}
            >
                Vote for This Reply
            </button>

            {totalVotes === 0 && (
                <p className="no-votes">No votes yet. Be the first to vote!</p>
            )}
        </div>
    );
};

export default DuplicateVotingPanel;