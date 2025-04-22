### Component Hierarchy and Responsibilities

#### StoryTreePage.js
**Theme:** Simple Router Component
- Acts as a wrapper rendering the main story tree holder.
- Handles route‑level concerns (e.g., reading URL params).
- Imports and renders `StoryTreeHolder.tsx`.

#### StoryTreeHolder.tsx
**Theme:** Container & Provider Setup
- Wraps children with `StoryTreeProvider` and `ReplyProvider`.
- Renders the `StoryTreeContent` component.

#### StoryTreeContent (inside StoryTreeHolder.tsx)
**Theme:** Initialization & Layout
- Uses React Router's `useParams` to extract the root UUID.
- Calls `StoryTreeOperator.initializeStoryTree` to fetch initial data.
- Renders `Header.js` for the top bar (logo, title, navigation).
- Renders `VirtualizedStoryList.tsx` for the tree display.
- Renders the `ReplyEditor` (conditional) for composing replies.

#### VirtualizedStoryList.tsx
**Theme:** Virtualized List & Dynamic Row Management
- Implements infinite-loading virtualization with `react-window` and `InfiniteLoader`.
- Adapts to container size via `AutoSizer`.
- Memoizes row components for performance.
- Uses `useDynamicRowHeight.ts` to measure and cache row heights.
- Renders `Row.tsx` for each visible level.

#### Row.tsx
**Theme:** Row Wrapper
- Observes and reports height changes to the list using `useDynamicRowHeight`.
- Applies conditional styles (hidden/visible) based on reply state.
- Renders `StoryTreeLevelComponent`.

#### StoryTreeLevel.tsx
**Theme:** Level Display & Navigation
- Differentiates between `MidLevel` (active thread) and `LastLevel` (end indicator).
- Manages pagination and swipe/arrow navigation among siblings.
- Renders:
  - `NodeContent.tsx` for content display and highlights.
  - `NodeFooter.tsx` for reply button and navigation controls.

#### NodeContent.tsx
**Theme:** Content & Highlighting
- Displays static highlights of existing quotes via `useHighlighting.ts`.
- Provides a selectable region for new quotes using `useTextSelection.ts`.

#### NodeFooter.tsx
**Theme:** Actions & Navigation
- Renders the "Reply" action button and sibling navigation arrows.
- Invokes `StoryTreeOperator.submitReply` to post replies.

#### Header.js
**Theme:** Top Bar UI
- Displays application logo, title, and subtitle.
- Handles click events for returning to the feed.

#### ReplyEditor (inside StoryTreeHolder.tsx)
**Theme:** Reply Input UI
- Uses `@uiw/react-md-editor` for Markdown authoring.
- Controlled by `ReplyContext.tsx` state.
- Provides Submit and Cancel buttons tied to operator methods.


#### Context & State Management
- `StoryTreeContext.tsx`: Manages core story tree state (levels, loading, errors).
- `ReplyContext.tsx`: Manages reply‑specific state (selected quote, content, errors).

#### Operators
- `frontend/src/operators/StoryTreeOperator.ts`: Singleton orchestrator for data fetching, pagination, quote counts, and reply submission.


### Component Hierarchy:
```
StoryTreePage.js
└── StoryTreeHolder.tsx
    └── StoryTreeContent
        ├── Header.js
        ├── VirtualizedStoryList.tsx
        │   └── Row.tsx
        │       └── StoryTreeLevelComponent
        │           ├── NodeContent.tsx
        │           └── NodeFooter.tsx
        └── ReplyEditor (conditional)
```

### Data Flow:
1. `StoryTreeProvider` and `ReplyProvider` wrap the content in `StoryTreeHolder.tsx`.
2. `StoryTreeContent` reads the root ID and initializes data via `StoryTreeOperator`.
3. `StoryTreeOperator` fetches levels and updates `StoryTreeContext`.
4. `VirtualizedStoryList` subscribes to context state for levels and renders rows.
5. Each `Row.tsx` measures size and renders `StoryTreeLevelComponent` for that level.
6. `StoryTreeLevelComponent` uses `NodeContent.tsx` and `NodeFooter.tsx` for display, navigation, and reply actions.
7. `useHighlighting.ts` and `useTextSelection.ts` manage highlights and new quote selections in `NodeContent.tsx`.
8. Reply actions update `ReplyContext` and invoke operator methods, causing state updates.
9. Context dispatches propagate changes, triggering UI re‑renders.