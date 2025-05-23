### Component Hierarchy and Responsibilities

#### PostPagePage.js
**Theme:** Simple Router Component
- Acts as a wrapper rendering the main post tree holder.
- Handles route‑level concerns (e.g., reading URL params).
- Imports and renders `PostPageHolder.tsx`.

#### PostPageHolder.tsx
**Theme:** Container & Provider Setup
- Wraps children with `PostPageProvider` and `ReplyProvider`.
- Fetches initial data via `PostPageOperator.initializePostPage` when the root UUID changes.
- Renders the `PostPageContent` component.

#### PostPageContent (inside PostPageHolder.tsx)
**Theme:** Layout & Conditional Rendering
- Renders `Header.js` for the top bar (logo, title, navigation, auth).
- Renders `MemoizedVirtualizedPostList` (the virtualized list component) passing the `postRootId`.
- Renders the `ReplyEditor` (defined in `PostPageHolder.tsx`) conditionally based on `ReplyContext` state.

#### VirtualizedPostList.tsx
**Theme:** Virtualized List & Infinite Loading
- Implements infinite-loading virtualization with `react-virtuoso`.
- Fetches subsequent levels progressively via `PostPageOperator.loadSingleLevel` using the `endReached` callback.
- Manages local loading and error states.
- Subscribes to `PostPageContext` for level data and `ReplyContext` (selectively) for `replyTarget` to determine row visibility.
- Renders `MemoizedRow` for each visible level.

#### Row.tsx
**Theme:** Row Wrapper & Navigation Logic Container
- Renders `PostPageLevelComponent`.
- Contains the logic and callbacks (`navigateToNextSiblingCallback`, `navigateToPreviousSiblingCallback`) for sibling navigation, passing them down to `PostPageLevelComponent`.
- Applies conditional styles (hidden/visible) based on reply state (`shouldHide` prop).
- Height is managed implicitly by `react-virtuoso` based on content.

#### PostPageLevelComponent (in PostPageLevel.tsx)
**Theme:** Level Display, Sibling State & Interaction
- Renders the content for a specific level based on `levelData` prop.
- Displays the currently selected sibling node within that level.
- Manages swipe gestures (`@use-gesture/react`) and animations (`framer-motion`) for sibling navigation.
- Handles pagination state for loading more siblings within the level (fetching delegated to operator).
- Renders memoized versions of:
  - `NodeContent.tsx` for content display, quote highlighting, and selection.
  - `NodeFooter.tsx` for reply button and navigation controls/hints.
- Uses `useReplyContextSelective` to optimize re-renders based on reply state.
- Displays a simple "End of thread" indicator if `levelData` represents a `LastLevel`.

#### NodeContent.tsx
**Theme:** Content Display, Highlighting & Selection Areas
- **Separation of Concerns:**
    - **Main Content Area (Non-Selectable):** Uses `MemoizedHighlightedText` (and `useHighlighting.ts`) to display *static* highlights of existing popular quotes (`existingSelectableQuotes`) and the quote being replied to (`levelSelectedQuote`).
    - **Quote Container (Selectable):** Uses `MemoizedTextSelection` (and `useTextSelection.ts`) to allow the user to *create* new quote selections when replying (only visible if `quote` prop is present).
- Receives callbacks (`onExistingQuoteSelectionComplete`) from parent to handle selection events.

#### NodeFooter.tsx
**Theme:** Actions & Navigation Controls
- Renders the "Reply" action button (text changes based on reply state: "Reply", "Cancel Reply", "Select Different Node").
- Renders sibling navigation indicators (`current / total`) and swipe hints/buttons.
- Invokes callbacks (`onReplyClick`, `onNextSibling`, `onPreviousSibling`) passed down from `Row.tsx`.
- Disables/adjusts appearance based on `isReplyTarget`, `isReplyActive`, and `replyError` props.

#### Header.js
**Theme:** Top Bar UI & Auth
- Displays application logo, title, and subtitle.
- Handles click events for returning to the feed (`onLogoClick`).
- Integrates with `UserContext` to display user info/login status and provides Sign In/Sign Out/Post actions via a modal menu.

#### ReplyEditor (inside PostPageHolder.tsx)
**Theme:** Reply Input UI
- Uses `@uiw/react-md-editor` for Markdown authoring.
- Controlled by `ReplyContext.tsx` state (`replyContent`, `setReplyContent`).
- Provides Submit and Cancel buttons tied to `PostPageOperator.submitReply` and local cancel handler (`handleReplyCancel`).

#### Context & State Management
- `PostPageContext.tsx`: Manages core story tree state (post, levels, loading, errors) using a reducer. State updates are primarily dispatched by `PostPageOperator`.
- `ReplyContext.tsx`: Manages reply‑specific state (target node, selected quote for reply, content, errors, open state) using `useState`.

#### Operators
- `frontend/src/operators/PostPageOperator.ts`: Class-based singleton orchestrator for data fetching (initial post, levels, replies, quote counts), pagination (cursor-based), state updates (dispatching actions to `PostPageContext`), node/quote selection logic, and reply submission. Requires injection of Store (`PostPageContext` state/dispatch) and `UserContext`.

#### Hooks
- `frontend/src/hooks/useHighlighting.ts`: Manages the *display* of static highlights in the main, non-selectable content area based on existing quote counts and the currently selected quote for reply.
- `frontend/src/hooks/useTextSelection.ts`: Manages the *creation* of new user text selections within the dedicated, selectable quote container area when replying.

### Component Hierarchy:
```
PostPagePage.js
└── PostPageHolder.tsx
    ├── PostPageProvider / ReplyProvider
    └── PostPageContent
        ├── Header.js
        ├── MemoizedVirtualizedPostList (VirtualizedPostList.tsx)
        │   └── MemoizedRow (Row.tsx)
        │       └── PostPageLevelComponent (PostPageLevel.tsx)
        │           ├── MemoizedNodeContent (NodeContent.tsx)
        │           │   ├── MemoizedHighlightedText (uses useHighlighting.ts)
        │           │   └── MemoizedTextSelection (uses useTextSelection.ts) [Conditional]
        │           └── MemoizedNodeFooter (NodeFooter.tsx)
        └── ReplyEditor [Conditional]
```

### Data Flow:
1. `PostTreeProvider` and `ReplyProvider` wrap the content in `PostPageHolder.tsx`.
2. `PostPageHolder` effect calls `PostPageOperator.initializePostPage` with the root UUID.
3. `PostPageOperator` fetches the root post (`/api/getPost/:uuid`), fetches its quote counts, creates the initial level (Level 0), and dispatches `INCLUDE_NODES_IN_LEVELS` to `PostPageContext`.
4. `VirtualizedPostList` subscribes to `PostPageContext` state for levels. It renders initial rows via `MemoizedRow`.
5. When the list scrolls to the end (`endReached`), `VirtualizedPostList` calls `PostPageOperator.requestLoadNextLevel` (or a similar method).
6. **Modified Reply Fetching Logic in `PostPageOperator` for Level N+1 (when a node in Level N is selected or when loading subsequent levels):**
    a. The operator identifies the selected parent node in Level N.
    b. It fetches all direct reply IDs for this parent node (e.g., from backend path like `replyMetadata/parentReplies/$parentId`).
    c. For each reply ID, it fetches the full reply data and its associated `QuoteCounts` (i.e., how many times quotes *within this reply* have been replied to by *its* children).
    d. A "total engagement score" is calculated for each reply (sum of its own quote counts).
    e. Replies are then sorted client-side: primarily by their "total engagement score" (descending), and secondarily by their creation date (descending for ties).
    f. The `Siblings` data structure for Level N+1 in `PostPageContext` becomes a single sorted array of these `PostTreeNode`s. The concept of `selectedQuoteInParent` is no longer used to determine *which set* of siblings to display.
    g. `PostPageOperator` dispatches `INCLUDE_NODES_IN_LEVELS` (or `REPLACE_LEVEL_DATA`) with this new level structure containing the sorted list of replies.
7. Each `MemoizedRow` renders `PostPageLevelComponent` for that level's data (which now contains a single, sorted list of siblings).
8. `PostPageLevelComponent` displays the selected node using `NodeContent` and `NodeFooter`. Sibling navigation within a level updates the selected node via `PostPageOperator.setSelectedNode`. The displayed siblings are from the sorted list.
9. `useHighlighting.ts` (in `NodeContent`) displays static highlights based on `existingSelectableQuotes` (quotes within the current node). Clicking a highlight calls `PostPageOperator.setSelectedQuoteForNodeInLevel`.
10. **Modified effect of `setSelectedQuoteForNodeInLevel`**: When a quote is selected *within* a node in Level N, this updates the `selectedQuoteInThisLevel` state for that node (for UI highlighting in `NodeContent`). However, it **does not** trigger a refetch or change the list of replies displayed in Level N+1. Level N+1 always shows all replies of the parent from Level N, sorted by engagement/recency.
11. Submitting a reply via `ReplyEditor` calls `PostPageOperator.submitReply`, which posts to the API (`/api/createReply`). After a successful submission, `PostPageOperator` will trigger a refresh of the relevant level (e.g., Level N+1 if the reply was to a node in Level N), applying the new sorting logic.
12. Context dispatches propagate state changes, triggering UI re‑renders in subscribed components.