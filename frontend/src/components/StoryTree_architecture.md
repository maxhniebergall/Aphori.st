### Component Hierarchy and Responsibilities

#### StoryTreePage.js
**Theme:** Simple Router Component
- Acts as a wrapper rendering the main story tree holder.
- Handles route‑level concerns (e.g., reading URL params).
- Imports and renders `StoryTreeHolder.tsx`.

#### StoryTreeHolder.tsx
**Theme:** Container & Provider Setup
- Wraps children with `StoryTreeProvider` and `ReplyProvider`.
- Fetches initial data via `StoryTreeOperator.initializeStoryTree` when the root UUID changes.
- Renders the `StoryTreeContent` component.

#### StoryTreeContent (inside StoryTreeHolder.tsx)
**Theme:** Layout & Conditional Rendering
- Renders `Header.js` for the top bar (logo, title, navigation, auth).
- Renders `MemoizedVirtualizedStoryList` (the virtualized list component) passing the `postRootId`.
- Renders the `ReplyEditor` (defined in `StoryTreeHolder.tsx`) conditionally based on `ReplyContext` state.

#### VirtualizedStoryList.tsx
**Theme:** Virtualized List & Infinite Loading
- Implements infinite-loading virtualization with `react-virtuoso`.
- Fetches subsequent levels progressively via `StoryTreeOperator.loadSingleLevel` using the `endReached` callback.
- Manages local loading and error states.
- Subscribes to `StoryTreeContext` for level data and `ReplyContext` (selectively) for `replyTarget` to determine row visibility.
- Renders `MemoizedRow` for each visible level.

#### Row.tsx
**Theme:** Row Wrapper & Navigation Logic Container
- Renders `StoryTreeLevelComponent`.
- Contains the logic and callbacks (`navigateToNextSiblingCallback`, `navigateToPreviousSiblingCallback`) for sibling navigation, passing them down to `StoryTreeLevelComponent`.
- Applies conditional styles (hidden/visible) based on reply state (`shouldHide` prop).
- Height is managed implicitly by `react-virtuoso` based on content.

#### StoryTreeLevelComponent (in StoryTreeLevel.tsx)
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

#### ReplyEditor (inside StoryTreeHolder.tsx)
**Theme:** Reply Input UI
- Uses `@uiw/react-md-editor` for Markdown authoring.
- Controlled by `ReplyContext.tsx` state (`replyContent`, `setReplyContent`).
- Provides Submit and Cancel buttons tied to `StoryTreeOperator.submitReply` and local cancel handler (`handleReplyCancel`).

#### Context & State Management
- `StoryTreeContext.tsx`: Manages core story tree state (post, levels, loading, errors) using a reducer. State updates are primarily dispatched by `StoryTreeOperator`.
- `ReplyContext.tsx`: Manages reply‑specific state (target node, selected quote for reply, content, errors, open state) using `useState`.

#### Operators
- `frontend/src/operators/StoryTreeOperator.ts`: Class-based singleton orchestrator for data fetching (initial post, levels, replies, quote counts), pagination (cursor-based), state updates (dispatching actions to `StoryTreeContext`), node/quote selection logic, and reply submission. Requires injection of Store (`StoryTreeContext` state/dispatch) and `UserContext`.

#### Hooks
- `frontend/src/hooks/useHighlighting.ts`: Manages the *display* of static highlights in the main, non-selectable content area based on existing quote counts and the currently selected quote for reply.
- `frontend/src/hooks/useTextSelection.ts`: Manages the *creation* of new user text selections within the dedicated, selectable quote container area when replying.

### Component Hierarchy:
```
StoryTreePage.js
└── StoryTreeHolder.tsx
    ├── StoryTreeProvider / ReplyProvider
    └── StoryTreeContent
        ├── Header.js
        ├── MemoizedVirtualizedStoryList (VirtualizedStoryList.tsx)
        │   └── MemoizedRow (Row.tsx)
        │       └── StoryTreeLevelComponent (StoryTreeLevel.tsx)
        │           ├── MemoizedNodeContent (NodeContent.tsx)
        │           │   ├── MemoizedHighlightedText (uses useHighlighting.ts)
        │           │   └── MemoizedTextSelection (uses useTextSelection.ts) [Conditional]
        │           └── MemoizedNodeFooter (NodeFooter.tsx)
        └── ReplyEditor [Conditional]
```

### Data Flow:
1. `StoryTreeProvider` and `ReplyProvider` wrap the content in `StoryTreeHolder.tsx`.
2. `StoryTreeHolder` effect calls `StoryTreeOperator.initializeStoryTree` with the root UUID.
3. `StoryTreeOperator` fetches the root post (`/api/getPost/:uuid`), fetches its quote counts, creates the initial level (Level 0), and dispatches `INCLUDE_NODES_IN_LEVELS` to `StoryTreeContext`.
4. `VirtualizedStoryList` subscribes to `StoryTreeContext` state for levels. It renders initial rows via `MemoizedRow`.
5. When the list scrolls to the end (`endReached`), `VirtualizedStoryList` calls `StoryTreeOperator.loadSingleLevel`.
6. `StoryTreeOperator` determines the next level to fetch based on the *last* level in context state, fetches replies/nodes (`/api/getReplies/...`), fetches their quote counts, creates the new level(s), and dispatches `INCLUDE_NODES_IN_LEVELS`.
7. Each `MemoizedRow` renders `StoryTreeLevelComponent` for that level's data.
8. `StoryTreeLevelComponent` displays the selected node using `NodeContent` and `NodeFooter`. Sibling navigation within a level updates the selected node via `StoryTreeOperator.setSelectedNode`, which dispatches `SET_SELECTED_NODE`.
9. `useHighlighting.ts` (in `NodeContent`) displays static highlights based on `existingSelectableQuotes` and `levelSelectedQuote`. Clicking a highlight calls `StoryTreeOperator.setSelectedQuoteForNodeInLevel`.
10. Clicking "Reply" in `NodeFooter` updates `ReplyContext` (setting `replyTarget`, `replyQuote`). `useTextSelection.ts` (in `NodeContent`) becomes active in the quote container.
11. Submitting a reply via `ReplyEditor` calls `StoryTreeOperator.submitReply`, which posts to the API (`/api/createReply`) and potentially updates the relevant level in `StoryTreeContext`.
12. Context dispatches propagate state changes, triggering UI re‑renders in subscribed components.