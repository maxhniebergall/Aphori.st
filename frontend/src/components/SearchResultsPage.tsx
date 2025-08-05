import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchSearchResults, SearchPagination } from '../operators/SearchOperator';
import { DisplaySearchResultItem } from '../types/search';
import Header from './Header'; // Assuming a global Header
import SearchResultsPageRow from './SearchResultsPageRow'; // Import the new component
import './SearchResultsPage.css'; // We will create this for styling
import { Virtuoso } from 'react-virtuoso';

const SearchResultsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('query');
  
  const [results, setResults] = useState<DisplaySearchResultItem[]>([]);
  const [pagination, setPagination] = useState<SearchPagination>({
    offset: 0,
    limit: 10,
    total: 0,
    hasMore: false
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [paginationLoading, setPaginationLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Function to fetch search results with pagination
  const fetchSearchResultsPage = useCallback(async (searchQuery: string, offset = 0, append = false) => {
    if (!searchQuery || searchQuery.trim() === '') {
      setResults([]);
      setPagination({
        offset: 0,
        limit: 10,
        total: 0,
        hasMore: false
      });
      return;
    }

    setError(null);
    if (!append) {
      setLoading(true);
    } else {
      setPaginationLoading(true);
    }

    try {
      const searchResult = await fetchSearchResults(searchQuery, { offset, limit: 10 });
      
      if (append) {
        setResults(prevResults => [...prevResults, ...searchResult.items]);
      } else {
        setResults(searchResult.items);
      }
      
      setPagination(searchResult.pagination);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching search results.');
      if (!append) {
        setResults([]); // Clear previous results on error only for new searches
      }
    } finally {
      if (!append) {
        setLoading(false);
      } else {
        setPaginationLoading(false);
      }
    }
  }, []);

  // Load initial results when query changes
  useEffect(() => {
    if (query) {
      fetchSearchResultsPage(query, 0, false);
    } else {
      // No query, so clear results and don't show loading/error for a search action
      setResults([]);
      setPagination({
        offset: 0,
        limit: 10,
        total: 0,
        hasMore: false
      });
      setLoading(false);
      setError(null); 
    }
  }, [query, fetchSearchResultsPage]);

  // Function to load more results for infinite scroll
  const loadMoreResults = useCallback(async () => {
    if (!query || !pagination.hasMore || loading || paginationLoading) return;
    
    const nextOffset = pagination.offset + pagination.limit;
    await fetchSearchResultsPage(query, nextOffset, true);
  }, [query, pagination.hasMore, pagination.offset, pagination.limit, loading, paginationLoading, fetchSearchResultsPage]);

  const handleLogoClick = () => {
    // Navigate to home or feed page, consistent with Header
    // This might require useNavigate if not a simple anchor
    window.location.href = '/'; 
  };

  // Define the item rendering function for Virtuoso
  const renderItem = useCallback((index: number, item: DisplaySearchResultItem) => {
    return <SearchResultsPageRow key={item.id} item={item} />;
  }, []);

  return (
    <div className="search-results-page-container">
      <Header onLogoClick={handleLogoClick} />
      <main className="search-results-content">
        {query && <h2>Search Results for: "{query}" ({pagination.total} results)</h2>}
        {!query && <h2>Enter a search term above to find posts and replies.</h2>}

        {loading && <div className="loading-indicator">Loading...</div>}
        
        {error && <div className="error-message">Error: {error}</div>}
        
        {!loading && !error && query && results.length === 0 && (
          <div className="no-results-message">No results found for "{query}".</div>
        )}
        
        {!loading && !error && results.length > 0 && (
          <div className="results-list" style={{ height: 'calc(100vh - 120px)' }}>
            <Virtuoso
              style={{ height: '100%' }}
              data={results}
              endReached={loadMoreResults}
              itemContent={renderItem}
              increaseViewportBy={window.innerHeight * 0.5}
              components={{
                Footer: () => {
                  return pagination.hasMore ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      Loading more results...
                    </div>
                  ) : results.length > 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                      End of search results
                    </div>
                  ) : null;
                },
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default SearchResultsPage; 