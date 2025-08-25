import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DisplaySearchResultItem, PostDisplaySearchResult, ReplyDisplaySearchResult } from '../types/search';
import './SearchResultsPageRow.css'; // We will create this for styling

interface SearchResultsPageRowProps {
  item: DisplaySearchResultItem;
}

const SearchResultsPageRow: React.FC<SearchResultsPageRowProps> = ({ item }) => {
  const navigate = useNavigate();

  const targetUrl = item.type === 'post' 
      ? `/postTree/${item.id}` 
      : `/postTree/${(item as ReplyDisplaySearchResult).rootPostId}/${item.id}`; // Navigate to root post with reply id for deep-linking

  // The design doc mentions a handleClick, but using <Link> is more idiomatic for navigation.
  // If more complex logic than navigation is needed on click, a handleClick can be added
  // to the wrapping div and navigate() can be used programmatically.

  return (
    <div className="search-result-row" role="article">
      <Link to={targetUrl} className="search-result-row-link">
        <div className="search-result-row-header">
          <span className={`search-result-type type-${item.type}`}>{item.type}</span>
          <span className="search-result-score">Score: {item.score.toFixed(2)}</span>
        </div>
        <h3 className="search-result-content-title">
          {item.content.substring(0, 150)}{item.content.length > 150 ? '...' : ''}
        </h3>
        <p className="search-result-author">Author ID: {item.authorId}</p>
        <p className="search-result-date">Created: {new Date(item.createdAt).toLocaleDateString()}</p>
        
        {item.type === 'post' && (item as PostDisplaySearchResult).replyCount !== undefined && (
          <p className="search-result-reply-count">Replies: {(item as PostDisplaySearchResult).replyCount}</p>
        )}

        {item.type === 'reply' && item.replyToQuote && (
          <div className="search-result-reply-to-quote">
            <p className="reply-to-quote-label">Replying to:</p>
            <blockquote className="reply-to-quote-text">
              {item.replyToQuote.text.substring(0, 100)}
              {item.replyToQuote.text.length > 100 ? '...' : ''}
            </blockquote>
            {/* <p className="reply-to-quote-source">Source ID: {item.replyToQuote.sourceId}</p> */}
          </div>
        )}
      </Link>
    </div>
  );
};

export default SearchResultsPageRow; 