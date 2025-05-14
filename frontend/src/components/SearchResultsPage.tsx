import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { fetchSearchResults } from '../operators/SearchOperator';
import { DisplaySearchResultItem, ReplyDisplaySearchResult } from '../types/search';
import Header from './Header'; // Assuming a global Header
import SearchResultsPageRow from './SearchResultsPageRow'; // Import the new component
import './SearchResultsPage.css'; // We will create this for styling

// Forward declaration for SearchResultsPageRow, to be created in Task 7
// For now, a placeholder rendering will be used directly in SearchResultsPage.
// Later, this would be imported: import SearchResultsPageRow from './SearchResultsPageRow';

const SearchResultsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('query');
  
  const [results, setResults] = useState<DisplaySearchResultItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query) {
      const performSearch = async () => {
        setLoading(true);
        setError(null);
        try {
          const searchData = await fetchSearchResults(query);
          setResults(searchData);
        } catch (err: any) {
          setError(err.message || 'An error occurred while fetching search results.');
          setResults([]); // Clear previous results on error
        }
        setLoading(false);
      };
      performSearch();
    } else {
      // No query, so clear results and don't show loading/error for a search action
      setResults([]);
      setLoading(false);
      setError(null); 
    }
  }, [query]);

  const handleLogoClick = () => {
    // Navigate to home or feed page, consistent with Header
    // This might require useNavigate if not a simple anchor
    window.location.href = '/'; 
  };

  // Placeholder Row rendering - will be replaced by SearchResultsPageRow component
  const renderRow = (item: DisplaySearchResultItem) => {
    const targetUrl = item.type === 'post' 
        ? `/post/${item.id}` 
        : `/post/${(item as ReplyDisplaySearchResult).rootPostId}`; // Navigate to root post for replies

    return (
        <div key={item.id} className="search-result-row-placeholder">
            <Link to={targetUrl} className="search-result-link">
                <h4>{item.type === 'post' ? 'Post' : 'Reply'}: {item.content.substring(0, 100)}{item.content.length > 100 ? '...' : ''}</h4>
                <p>Author ID: {item.authorId} | Score: {item.score.toFixed(2)}</p>
                <p><em>Created: {new Date(item.createdAt).toLocaleDateString()}</em></p>
                {item.type === 'reply' && (item as ReplyDisplaySearchResult).replyToQuote && (
                    <div className="reply-to-quote-preview">
                        <p><strong>Replying to:</strong> "{(item as ReplyDisplaySearchResult).replyToQuote?.text.substring(0,50)}..."</p>
                    </div>
                )}
            </Link>
        </div>
    );
  }

  return (
    <div className="search-results-page-container">
      <Header onLogoClick={handleLogoClick} />
      <main className="search-results-content">
        {query && <h2>Search Results for: "{query}"</h2>}
        {!query && <h2>Enter a search term above to find posts and replies.</h2>}

        {loading && <div className="loading-indicator">Loading...</div>}
        
        {error && <div className="error-message">Error: {error}</div>}
        
        {!loading && !error && query && results.length === 0 && (
          <div className="no-results-message">No results found for "{query}".</div>
        )}
        
        {!loading && !error && results.length > 0 && (
          <div className="results-list">
            {results.map(item => <SearchResultsPageRow key={item.id} item={item} />)}
          </div>
        )}
      </main>
    </div>
  );
};

export default SearchResultsPage; 