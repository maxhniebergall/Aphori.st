### Component Hierarchy and Responsibilities

### StoryTreePage.js
**Theme**: Simple Router Component
- Acts as a basic wrapper component
- Only renders StoryTreeHolder
- Handles route-level concerns

### StoryTreeHolder.js
**Theme**: Main Container & Layout Orchestrator
- Serves as the primary container component
- Manages layout and component composition
- Integrates StoryTreeOperator, StoryTreeHeader, and EditingOverlay
- Provides error boundary wrapper

### StoryTreeOperator.js
**Theme**: Data and State Management
- Connects to StoryTreeContext
- Handles data fetching and caching
- Manages node operations and updates
- Provides data and callbacks to child components
- Controls loading states and error handling

### VirtualizedStoryList.js
**Theme**: List Virtualization
- Handles all virtualization logic
- Manages infinite scrolling implementation
- Controls dynamic sizing of nodes
- Uses react-window for efficient list rendering
- Handles row measurement and caching

### StoryTreeContext.js 
**Theme**: Centralized State Management
- Manages global application state
- Provides state and dispatch to components
- Implements context provider pattern
- Handles error boundaries
- Manages loading states

### StoryTreeActions.js
**Theme**: Action Creators & Data Operations
- Contains all action creators
- Handles API interactions
- Manages complex state updates
- Provides error handling for data operations
- Controls loading states during operations

### StoryTreeNode.js
**Theme**: Interactive Node Display
- Renders individual story nodes
- Uses useSiblingNavigation hook
- Handles node-level interactions
- Manages node-specific animations
- Focuses on presentation logic

### StoryTreeHeader.js
**Theme**: Header UI Component
- Displays application logo and menu
- Shows story title and author information
- Handles header-specific interactions
- Contains isolated header styles

### Custom Hooks
**useSiblingNavigation.js**
- Manages sibling navigation logic
- Handles sibling state and loading
- Provides navigation methods
- Controls sibling-related animations

### Component Hierarchy:
StoryTreePage
└── StoryTreeHolder
    ├── StoryTreeHeader
    ├── StoryTreeOperator
    │   └── VirtualizedStoryList
    │       └── StoryTreeNode (multiple instances)
    └── EditingOverlay (conditional)

### Data Flow:
1. StoryTreeContext provides global state
2. StoryTreeOperator manages data operations
3. Components dispatch actions through context
4. StoryTreeActions handle complex updates
5. Data flows down through props
6. User interactions flow up through callbacks