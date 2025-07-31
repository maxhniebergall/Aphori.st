import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { DuplicateGroup, DuplicateReply, Reply, DuplicateComparisonResponse } from '../types/types';
import Header from './Header';
import DuplicateComparisonView from './DuplicateComparisonView';
import './DuplicateComparisonPage.css';

const DuplicateComparisonPage: React.FC = () => {
    const { groupId } = useParams<{ groupId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [duplicateData, setDuplicateData] = useState<{
        originalReply: Reply;
        duplicates: DuplicateReply[];
        group: DuplicateGroup;
    } | null>(null);

    const fetchDuplicateGroup = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await axios.get<DuplicateComparisonResponse>(`/api/replies/duplicate/${groupId}`);
            
            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error || 'Failed to fetch duplicate group');
            }

            setDuplicateData(response.data.data);
        } catch (err) {
            console.error('Error fetching duplicate group:', err);
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                setError('Duplicate group not found');
            } else {
                setError('Failed to load duplicate group');
            }
        } finally {
            setLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        if (!groupId) {
            setError('Invalid duplicate group ID');
            setLoading(false);
            return;
        }

        fetchDuplicateGroup();
    }, [groupId, fetchDuplicateGroup]);

    const handleVote = async (replyId: string) => {
        if (!groupId) return;

        try {
            const response = await axios.post(`/api/replies/duplicate/${groupId}/vote`, {
                replyId: replyId
            });

            if (response.data.success) {
                // Refresh the duplicate group data to show updated votes
                await fetchDuplicateGroup();
            } else {
                console.error('Failed to record vote:', response.data.error);
            }
        } catch (err) {
            console.error('Error recording vote:', err);
        }
    };

    const handleBackToPost = () => {
        if (duplicateData?.originalReply.rootPostId) {
            navigate(`/postTree/${duplicateData.originalReply.rootPostId}`);
        } else {
            navigate('/feed');
        }
    };

    const handleLogoClick = () => {
        navigate('/feed');
    };

    if (loading) {
        return (
            <div className="duplicate-comparison-page">
                <Header onLogoClick={handleLogoClick} />
                <div className="main-content">
                    <div className="loading-state">
                        <div className="loading-spinner"></div>
                        <p>Loading duplicate comparison...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="duplicate-comparison-page">
                <Header onLogoClick={handleLogoClick} />
                <div className="main-content">
                    <div className="error-state">
                        <h2>Error</h2>
                        <p>{error}</p>
                        <button onClick={() => navigate('/feed')} className="back-button">
                            Back to Feed
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!duplicateData) {
        return (
            <div className="duplicate-comparison-page">
                <Header onLogoClick={handleLogoClick} />
                <div className="main-content">
                    <div className="error-state">
                        <h2>No Data</h2>
                        <p>No duplicate group data available</p>
                        <button onClick={() => navigate('/feed')} className="back-button">
                            Back to Feed
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="duplicate-comparison-page">
            <Header onLogoClick={handleLogoClick} />
            <div className="main-content">
                <div className="duplicate-header">
                    <h1>Duplicate Replies Found</h1>
                    <p className="duplicate-description">
                        These replies were detected as similar. You can compare them and vote for the best one.
                    </p>
                    <button onClick={handleBackToPost} className="back-to-post-button">
                        ← Back to Discussion
                    </button>
                </div>

                <DuplicateComparisonView
                    originalReply={duplicateData.originalReply}
                    duplicates={duplicateData.duplicates}
                    group={duplicateData.group}
                    onVote={handleVote}
                />
            </div>
        </div>
    );
};

export default DuplicateComparisonPage;