### Component Hierarchy and Responsibilities

#### StoryTreePage.js  
**Theme:** Simple Router Component  
- Acts as a basic wrapper component.  
- Only renders `StoryTreeHolder`.  
- Handles route-level concerns.

#### StoryTreeHolder.js  
**Theme:** Main Container & Layout Orchestrator  
- Serves as the primary container component.  
- Manages layout and component composition.  
- Integrates `StoryTreeOperator`, `StoryTreeHeader`, and `EditingOverlay`.  
- Provides an error boundary wrapper.

#### StoryTreeOperator.js  
**Theme:** Data and State Management  
- Connects to `StoryTreeContext`.  
- Handles data fetching, caching, and node operations.  
- **Asynchronously updates node quote counts:**  
  Utilizes the dedicated `/api/getQuoteCounts/:id` endpoint to fetch quote reply counts. Once retrieved, `StoryTreeOperator` updates the corresponding node's `quoteCounts` field using immutable state updates and dispatches the updated node details via the existing `ACTIONS.INCLUDE_NODES_IN_LEVELS` action.  
- Provides data and callbacks to child components.  
- Controls loading states and error handling.

#### VirtualizedStoryList.js  
**Theme:** List Virtualization  
- Handles all virtualization logic.  
- Manages infinite scrolling implementation.  
- Controls dynamic sizing of nodes.  
- Uses `react-window` for efficient list rendering.  
- Manages row measurement and caching.

#### StoryTreeContext.js  
**Theme:** Centralized State Management  
- Manages global application state.  
- Provides state and dispatch to components.  
- Implements the context provider pattern.  
- Handles error boundaries and loading states.

#### StoryTreeActions.js  
**Theme:** Action Creators & Data Operations  
- Contains all action creators.  
- Handles API interactions and complex state updates.  
- Provides error handling for data operations.  
- Controls loading states during operations.

#### StoryTreeNode.js  
**Theme:** Interactive Node Display  
- Renders individual story nodes.  
- Uses custom hooks such as `useSiblingNavigation`.  
- Handles node-level interactions and animations.  
- Focuses on presentation logic.

#### StoryTreeHeader.js  
**Theme:** Header UI Component  
- Displays application logo and menu.  
- Shows story title and author information.  
- Handles header-specific interactions.  
- Contains isolated header styles.

#### Custom Hooks

##### useSiblingNavigation.js  
- Manages sibling navigation logic.  
- Handles sibling state and loading.  
- Provides navigation methods.  
- Controls sibling-related animations.

### Component Hierarchy:
```
StoryTreePage
└── StoryTreeHolder
    ├── StoryTreeHeader
    ├── StoryTreeOperator
    │   └── VirtualizedStoryList
    │       └── StoryTreeNode (multiple instances)
    └── EditingOverlay (conditional)
```

### Data Flow:
1. `StoryTreeContext` provides the global state.
2. `StoryTreeOperator` manages data operations—including asynchronous updates via the quote counts API.
3. Components dispatch actions through context.
4. `StoryTreeActions` handle complex state updates.
5. Data flows down through props.
6. User interactions flow up through callbacks.