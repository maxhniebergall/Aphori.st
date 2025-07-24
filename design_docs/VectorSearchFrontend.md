# Frontend Vector Search Implementation: Design Document

**Version:** 1.0
**Date:** May 13, 2025
**Author:** Gemini AI

## 1. Overview

This document outlines the plan for implementing a vector search feature on the Aphorist frontend. Users will be able to enter search queries into a search bar located in the application header. Executing a search will navigate the user to a dedicated search results page, displaying posts and replies relevant to their query. This initial implementation will handle a maximum of 10 results, with pagination planned for a future iteration.

## 2. Goals

* Create a new `SearchBar` component
* Integrate the search bar into the `Header` component.
* Create a new `SearchResultsPage` component to display search results.
* Implement functionality to fetch search results from the backend `/api/search` endpoint.
* Display search results in a format similar to the existing `Feed` page, using the `Row` component.
* Allow users to click on a search result (post or reply) and be redirected to the respective post page.
* Provide clear user feedback for loading states and no-results scenarios.

## 3. Non-Goals (For this Iteration)

* Pagination for search results (will assume max 10 results).
* Direct navigation to a specific reply within a `PostTree`. Clicking a reply result will navigate to the parent post page.
* Highlighting search terms within the results.
* Advanced search filters or syntax.
* Real-time search suggestions.

## 4. Proposed Changes

### 4.1. Header Component (`frontend/src/components/Header.tsx`)

* **Add a Search Bar:**
    * A new search input field and a submit icon will be added to the `Header` component.
    * The search bar should be visually distinct and easily accessible.
    * Use a magnifying glass icon for the search button.
* **State Management for Search Input:**
    * The `Header` component (or a new child `SearchBar` component) will manage the state of the search input field.
* **Search Execution:**
    * On submitting the search (e.g., pressing Enter or clicking the search button), the application will navigate to the search results page with the query as a URL parameter.

### 4.2. Search Bar Component (New Suggested Component: `frontend/src/components/SearchBar.tsx`)

* **Responsibilities:**
    * Render the search input field and submit button.
    * Manage the local state of the search query input.
    * Handle search submission (e.g., on Enter key press or button click).
    * On submission, it will use the `react-router` `useNavigate` hook to navigate to the search results page, passing the query as a URL parameter (e.g., `/search?q=my%20search%20term`).
* **Props:**
    * `initialQuery?: string` (optional, to pre-fill search bar if navigating back or sharing a search URL)

### 4.3. Search Results Page (New Component: `frontend/src/components/SearchResultsPage.tsx`)

* **Route:** `/search`
* **Responsibilities:**
    * Parse the search query from the URL parameters (using `useSearchParams` from `react-router-dom`).
    * Display the search query (e.g., "Search results for: 'query'").
    * Fetch search results from the backend API when the component mounts or when the search query changes.
    * Manage loading, success, and error states for the API request.
    * If results are found:
        * Display them in a list, similar to the `Feed` component.
        * Each result will be rendered using the existing `Row` component or a slightly modified version if needed.
        * The `Row` component will need to handle both `PostSearchResult` and `ReplySearchResult` types.
    * If no results are found:
        * Display a "No results found for 'query'" message.
    * If an error occurs:
        * Display an appropriate error message.
* **Structure:**
    * Will likely use `useEffect` to fetch data based on the query parameter.
    * Will use a state variable to store the search results (e.g., `useState<SearchResultItem[]>([])`).
    * Will use state variables for loading and error status.

### 4.4. Search Operator/Service (New File: `frontend/src/operators/SearchOperator.ts`)

* **Purpose:** To encapsulate the logic for fetching search results from the backend.
* **Functions:**
    * `fetchSearchResults(query: string): Promise<SearchResultItem[]>`:
        * Makes a GET request to `/api/search?q=<encoded_query>`.
        * Handles API response and potential errors.
        * Returns the array of search results.
* **Data Types:**
    * Define `SearchResultItem`, `PostSearchResult`, and `ReplySearchResult` interfaces/types based on the backend response structure. These might already exist or can be added to a new `frontend/src/types/search.ts`.

    ```typescript
    // In frontend/src/types/types.ts or a new search types file

    export interface Quote {
      source: string;
      text: string;
      // other quote properties if any
    }

    export interface BaseSearchResult {
      id: string;
      content: string;
      author: string;
      createdAt: number; // Timestamp
      score: number; // Relevance score
      quote?: Quote;
    }

    export interface PostSearchResult extends BaseSearchResult {
      type: 'post';
    }

    export interface ReplySearchResult extends BaseSearchResult {
      type: 'reply';
      postId: string;
      parentReplyId?: string;
    }

    export type SearchResultItem = PostSearchResult | ReplySearchResult;
    ```

### 4.5. Routing (`frontend/src/App.jsx`)

* Add a new route for the `SearchResultsPage`:
    ```javascript
    // In App.jsx
    import SearchResultsPage from './components/SearchResultsPage';
    // ... other imports

    // Inside the <Routes> component
    <Route path="/search" element={<SearchResultsPage />} />
    ```

### 4.6. State Management

* **Search Query:** The primary source of truth for the current search query will be the URL parameter on the `/search` route. The `SearchBar` component will update this URL on submission. The `SearchResultsPage` will read from it.
* **Search Results:** The `SearchResultsPage` component will manage the state of the fetched search results, loading status, and error status locally using `useState` and `useEffect`.
* No global state (like Context or Redux) seems necessary for this initial implementation unless other parts of the app need to react to search results directly.

## 5. API Contract (Backend: `GET /api/search`)

* **Endpoint:** `GET /api/search`
* **Query Parameters:**
    * `q`: (string, required) The search query.
* **Success Response (200 OK):**
    * **Body:** `SearchResultItem[]`
        ```json
        [
          {
            "id": "postId123",
            "type": "post",
            "content": "This is the content of the post...",
            "author": "authorId1",
            "createdAt": 1678886400000,
            "score": 0.85,
            "quote": { "source": "Book Title", "text": "Quoted text..." } // Optional
          },
          {
            "id": "replyId456",
            "type": "reply",
            "content": "This is a reply to a post...",
            "author": "authorId2",
            "createdAt": 1678887400000,
            "score": 0.78,
            "postId": "postId123",
            "parentReplyId": "replyId789" // Optional
          }
          // ... up to 10 results
        ]
        ```
* **Error Responses:**
    * `400 Bad Request`: If `q` parameter is missing or invalid.
    * `500 Internal Server Error`: For backend issues.

## 6. Data Models (Frontend)

As defined in section 4.4: `SearchResultItem`, `PostSearchResult`, `ReplySearchResult`. These types will be used in `SearchResultsPage.tsx` and `SearchOperator.ts`.

## 7. Click Handling and Navigation in `SearchResultsPageRow.tsx` (or equivalent)

* The `SearchResultsPageRow` component will need to handle clicks on search results.
* **If `result.type === 'post'`:**
    * Navigate to `/post/${result.id}`.
* **If `result.type === 'reply'`:**
    * Navigate to `/post/${result.postId}`.
    * **TODO for future:** Implement functionality in `PostTree` and `PostPage` to scroll to and highlight the specific reply. For now, navigating to the parent post is sufficient.
* The `onClick` handler in the `SearchResultsPageRow` component will use `useNavigate` from `react-router-dom`.

```typescript
// Simplified example for SearchResultsPageRow.tsx 
import { useNavigate } from 'react-router-dom';
import { SearchResultItem } from '../types/types'; // Adjust path

interface SearchRowProps {
  item: SearchResultItem;
}

const SearchRow: React.FC<SearchRowProps> = ({ item }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (item.type === 'post') {
      navigate(`/post/${item.id}`);
    } else if (item.type === 'reply') {
      navigate(`/post/${item.postId}`); // TODO: Add #replyId or similar for future deep linking
    }
  };

  // Adapt existing Row rendering logic or create a new one
  return (
    <div className="row search-result-row" onClick={handleClick} style={{ cursor: 'pointer' }}>
      {/* Display item.content, item.author, item.type, item.score etc. */}
      <p><strong>Type:</strong> {item.type}</p>
      <p>{item.content}</p>
      <p><em>Author: {item.author}, Score: {item.score.toFixed(2)}</em></p>
      {item.quote && (
        <div className="quote-preview">
          <p><strong>Referenced Quote:</strong> "{item.quote.text}" - <em>{item.quote.source}</em></p>
        </div>
      )}
    </div>
  );
};

8. UI/UX Considerations
* Search Bar Placement: Prominently in the Header.
* Loading State:
    * SearchResultsPage: Display a loading indicator (e.g., spinner or skeleton screens for rows) while fetching results.
* No Results State:
    * SearchResultsPage: Clearly indicate when a search yields no results (e.g., "No results found for '[query]'.").
* Error Handling:
    * SearchResultsPage: Display user-friendly error messages if the API call fails.
* Responsiveness: Ensure the search bar and results page are responsive and usable on different screen sizes.
* Accessibility:
    * Ensure the search input has a proper label.
    * Search results should be navigable via keyboard.
9. Tasks Breakdown
1. Backend Check: Confirm /api/search endpoint is fully functional and returns data in the expected format.
2. Define Types: Add SearchResultItem, PostSearchResult, ReplySearchResult to frontend/src/types/.
3. Create SearchOperator.ts: Implement fetchSearchResults function.
4. Create SearchBar.tsx Component:
    * Input field and submit button/icon.
    * State for input value.
    * Navigation logic on submit.
5. Integrate SearchBar.tsx into Header.tsx.
6. Create SearchResultsPage.tsx Component:
    * Routing setup in App.jsx.
    * Parse query from URL.
    * Call SearchOperator.fetchSearchResults.
    * Manage loading, results, no-results, and error states.
    * Render results using SearchResultsPageRow
7. Create SearchResultsPageRow.ts:
    * Handle SearchResultItem data.
    * Implement click navigation to post pages.
8. Styling: Apply CSS for SearchBar, SearchResultsPage, and individual result rows to match the application's theme and ensure a good user experience.
9. Testing:
    * Test search functionality with various queries (empty, short, long, special characters).
    * Test navigation from search results.
    * Test loading, no-results, and error states.
    * Test responsiveness.
10. Future Enhancements
* Pagination: Implement infinite scrolling or numbered pagination for search results. This will require backend support for cursors or page numbers.
* Direct Navigation to Replies: Enhance PostPage and PostTree to accept a replyId parameter to scroll to and highlight a specific reply. Update search result click handling.
* Highlighting Search Terms: If the backend can provide match offsets, highlight the search query within the result content.
* Advanced Search Filters: Allow filtering by author, date, type (post/reply), etc.
* Debouncing Search Input: For a type-as-you-go search experience (if implemented later).
11. Open Questions/Discussion Points
* Exact styling and placement of the search bar in the Header.
* Specific design for skeleton loaders for search results.
* Error message specifics for API failures.
