# Frontend Core Implementation Plan

## Overview
Frontend components and services for vector search functionality.

## Dependencies
- **PARALLEL DEVELOPMENT**: Can be implemented alongside backend API development
- No sequential dependencies within frontend tracks
- Final integration requires backend API to be functional

## Parallel Implementation Tracks

### Track A: Type Definitions & Data Layer
**IMPLEMENT FIRST** - Other tracks depend on these types

1. **Define Search Types** (`frontend/src/types/search.ts` or extend existing types)
   ```typescript
   export interface SearchResultItem {
     id: string;
     type: 'post' | 'reply';
     content: string;
     author: string;
     createdAt: number;
     score: number;
     // Additional fields based on backend response
   }
   
   export interface PostSearchResult extends SearchResultItem {
     type: 'post';
   }
   
   export interface ReplySearchResult extends SearchResultItem {
     type: 'reply';
     postId: string;
     parentReplyId?: string;
   }
   ```

2. **Create Search Operator** (`frontend/src/operators/SearchOperator.ts`)
   - `fetchSearchResults(query: string): Promise<SearchResultItem[]>`
   - HTTP client integration
   - Error handling and retry logic
   - Response validation and parsing

### Track B: Search UI Components
**CAN BE IMPLEMENTED IN PARALLEL** with Track A (mock data for initial development)

1. **Create SearchBar Component** (`frontend/src/components/SearchBar.tsx`)
   - Input field with search icon
   - Submit on Enter key or button click
   - URL navigation using `useNavigate`
   - Input validation and state management

2. **Create SearchResultsPage Component** (`frontend/src/components/SearchResultsPage.tsx`)
   - URL parameter parsing with `useSearchParams`
   - API integration with SearchOperator
   - Loading, success, error, and no-results states
   - Results rendering with SearchResultsPageRow

3. **Create SearchResultsPageRow Component** (`frontend/src/components/SearchResultsPageRow.tsx`)
   - Individual result display
   - Click handling for navigation to posts
   - Score display and content preview
   - Type indicators (post vs reply)

### Track C: Integration Components
**SEQUENTIAL DEPENDENCY** - Requires Track B components to exist

1. **Header Integration** (`frontend/src/components/Header.tsx`)
   - Add SearchBar component to header layout
   - Responsive positioning
   - Maintain existing header functionality

2. **Routing Setup** (`frontend/src/App.jsx`)
   - Add `/search` route for SearchResultsPage
   - Route parameter configuration
   - Navigation integration

## Implementation Details

### SearchBar Component Specifications
- **Placeholder**: "Search posts and replies..."
- **Icon**: Magnifying glass (search icon)
- **Behavior**: Navigate to `/search?q=${encodeURIComponent(query)}`
- **Validation**: Minimum 2 characters, maximum 200 characters

### SearchResultsPage Component Specifications
- **URL Pattern**: `/search?q=search%20term`
- **Loading State**: Skeleton loaders for result rows
- **No Results**: "No results found for 'query'" message
- **Error State**: Generic error message with retry option
- **Results Display**: Up to 10 results, no pagination

### Navigation Logic
```typescript
// For post results
navigate(`/post/${result.id}`);

// For reply results
navigate(`/post/${result.postId}`);
// TODO: Future enhancement - scroll to specific reply
```

### Component State Management
- **Local State**: Use `useState` and `useEffect` in components
- **No Global State**: URL parameters serve as source of truth
- **Search Results**: Managed locally in SearchResultsPage
- **Loading States**: Component-level state management

## Styling Requirements

### SearchBar Styling
- Consistent with existing header elements
- Responsive design for mobile/desktop
- Focus states and accessibility
- Search icon positioning

### SearchResultsPage Styling
- Similar layout to Feed component
- Loading skeletons matching existing patterns
- Error and empty states styling
- Result row hover effects

### SearchResultsPageRow Styling
- Consistent with existing Row component
- Score display styling
- Type badges (post/reply)
- Content preview truncation

## Files to Create/Modify
- `frontend/src/types/search.ts` (NEW) or extend existing types
- `frontend/src/operators/SearchOperator.ts` (NEW)
- `frontend/src/components/SearchBar.tsx` (NEW)
- `frontend/src/components/SearchResultsPage.tsx` (NEW)
- `frontend/src/components/SearchResultsPageRow.tsx` (NEW)
- `frontend/src/components/Header.tsx` (MODIFY - add SearchBar)
- `frontend/src/App.jsx` (MODIFY - add search route)

## Development Testing Strategy
- **Mock Data**: Create sample SearchResultItem arrays for component development
- **Storybook**: Component isolation testing (if available)
- **Local Testing**: Use mock backend responses
- **Responsive Testing**: Mobile and desktop layouts
- **Accessibility Testing**: Keyboard navigation and screen readers