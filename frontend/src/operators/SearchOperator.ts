import axios from 'axios';
import {
    VectorSearchApiResponse,
    RawSearchResultItem,
    DisplaySearchResultItem,
    BackendPostData,
    BackendReplyData,
    DisplayReplyTargetQuote
} from '../types/search';

const API_BASE_URL = process.env.REACT_APP_API_URL + "/api"; // Assuming your API is served from /api

export interface SearchPagination {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export interface SearchResult {
    items: DisplaySearchResultItem[];
    pagination: SearchPagination;
}

/**
 * Transforms a RawSearchResultItem from the backend into a DisplaySearchResultItem for the frontend.
 * @param rawItem - The raw search result item from the backend.
 * @returns A DisplaySearchResultItem or null if transformation is not possible.
 */
const transformSearchResult = (rawItem: RawSearchResultItem): DisplaySearchResultItem | null => {
    const { id, type, score, data } = rawItem;

    if (!data) return null; // Should not happen if API is correct

    const baseResult = {
        id,
        type,
        score,
        authorId: (data as BackendPostData | BackendReplyData).authorId,
        createdAt: (data as BackendPostData | BackendReplyData).createdAt,
    };

    if (type === 'post') {
        const postData = data as BackendPostData;
        return {
            ...baseResult,
            type: 'post',
            content: postData.content,
            replyCount: postData.replyCount,
        };
    } else if (type === 'reply') {
        const replyData = data as BackendReplyData;
        let displayQuote: DisplayReplyTargetQuote | undefined = undefined;
        if (replyData.quote) {
            displayQuote = {
                text: replyData.quote.text,
                sourceId: replyData.quote.sourceId,
            };
        }
        return {
            ...baseResult,
            type: 'reply',
            content: replyData.text,
            rootPostId: replyData.rootPostId,
            replyToQuote: displayQuote,
        };
    }
    return null; // Should not be reached if type is always 'post' or 'reply'
};

/**
 * Fetches search results from the backend vector search API with pagination support.
 * @param query - The search query string.
 * @param options - Pagination options (offset, limit).
 * @returns A promise that resolves to a SearchResult with items and pagination info.
 * @throws Will throw an error if the API call fails or returns an unsuccessful response.
 */
export const fetchSearchResults = async (
    query: string, 
    options: { offset?: number; limit?: number } = {}
): Promise<SearchResult> => {
    if (!query || query.trim() === '') {
        return {
            items: [],
            pagination: {
                offset: 0,
                limit: 10,
                total: 0,
                hasMore: false
            }
        }; // Return empty for empty query as per typical search behavior
    }

    const { offset = 0, limit = 10 } = options;

    try {
        const response = await axios.get<VectorSearchApiResponse>(
            `${API_BASE_URL}/search/vector`,
            {
                params: { 
                    query: query,
                    offset: offset.toString(),
                    limit: limit.toString()
                },
            }
        );

        if (response.data && response.data.success) {
            const transformedItems = response.data.results
                .map(transformSearchResult)
                .filter(item => item !== null) as DisplaySearchResultItem[];

            return {
                items: transformedItems,
                pagination: response.data.pagination || {
                    offset,
                    limit,
                    total: transformedItems.length,
                    hasMore: false
                }
            };
        } else {
            const errorMessage = response.data?.error || 'Failed to fetch search results.';
            console.error('Search API Error:', errorMessage, response.data);
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Error fetching search results:', error);
        if (axios.isAxiosError(error) && error.response) {
            // Backend error with a specific message
            throw new Error(error.response.data?.error || 'An unexpected error occurred during search.');
        } else if (error instanceof Error) {
            // Network error or error thrown by previous conditions
            throw error;
        }
        throw new Error('An unexpected error occurred while trying to search.');
    }
};

/**
 * Legacy function for backward compatibility - fetches first page of results
 */
export const fetchSearchResultsLegacy = async (query: string): Promise<DisplaySearchResultItem[]> => {
    const result = await fetchSearchResults(query, { offset: 0, limit: 10 });
    return result.items;
}; 