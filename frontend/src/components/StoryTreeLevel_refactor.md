## Discussion Overview

We've analyzed the current implementation of the `StoryTreeLevel` component, which uses nested virtualization with `InfiniteLoader` and `VariableSizeList` components from react-window. We identified that this adds unnecessary complexity since:

1. Only one sibling node is displayed at a time
2. Navigation between siblings is gesture-based (swipe) rather than scroll-based
3. The component already exists within a virtualized parent list (`VirtualizedStoryList`)
4. The current implementation introduces double virtualization which isn't needed for this UI pattern

## Conclusion

We should remove the inner `InfiniteLoader` and `VariableSizeList` from `StoryTreeLevel` while preserving all existing functionality. This will simplify the component, improve performance, and make the code more maintainable.

## Key Requirements for New StoryTreeLevel

### Core Functionality
- Display the current sibling node for a given level
- Support horizontal swipe gestures between siblings
- Maintain pagination for loading more siblings
- Preserve reply mode functionality
- Support node selection and quote selection
- Communicate height changes to parent components for proper virtualization

### Quote-Related Requirements
- Display selectable quotes within nodes
- Allow users to select text for replies
- Show quote counts for available replies
- Filter responses based on selected quotes
- Update the UI when a quote is selected to show relevant replies
- Maintain integration with `useTextSelection` hook
- Preserve quote highlighting based on reply counts
- Ensure NodeContent receives and properly rerenders when quote counts change

### UI/UX Requirements
- Animate transitions between siblings
- Show navigation indicators (previous/next)
- Indicate when a node is in reply mode
- Maintain accessibility compliance
- Support gesture and button-based navigation
- Adapt to viewport sizes with responsive dimensions
- Handle window resize events appropriately
- Use relative sizing when appropriate for UI consistency

### Technical Requirements
- Implement cursor-based pagination rather than index-based loading
  - Maintain both forward and backward pagination cursor state
  - Support prepending/appending nodes based on cursor direction
  - Prefetch siblings before they are needed for smooth navigation
- Properly integrate with StoryTreeOperator
  - Update global state when a node is selected
  - Make pagination requests at appropriate times
  - Handle error states from operator responses
- Maintain current node state across rerenders
- Support immutable state updates
- Correctly handle quote metadata
- Integrate with parent virtualization
  - Provide height updates to parent components
  - Work with the `useDynamicRowHeight` hook used in parent containers
  - Expose a height callback for the parent to update row height cache

## New StoryTreeLevel Structure

```markdown
StoryTreeLevelComponent
├── State Management
│   ├── Current index tracking
│   ├── Current node reference
│   ├── Cursor-based pagination state
│   └── Responsive dimensions
│
├── Gesture Handling
│   ├── Swipe detection (useGesture)
│   └── Navigation callbacks
│
├── Quote Selection Logic
│   ├── Quote filtering
│   ├── Integration with useTextSelection
│   └── Selection handlers
│
├── Reply Mode Logic
│   ├── Reply target handling
│   └── Quote creation
│
├── Parent Integration
│   ├── Height reporting
│   └── Dynamic sizing
│
├── Rendering
│   ├── AnimatePresence (motion)
│   ├── Current Node Display
│   │   ├── NodeContent (with quote selection)
│   │   └── NodeFooter (with navigation controls)
│   └── Pagination Controls
│
└── Side Effects
    ├── Load more siblings with cursor pagination
    ├── Update selected node in context
    ├── Handle dimension changes
    └── StoryTreeOperator integration
```

The new implementation will maintain all existing functionality while removing the unnecessary virtualization layer, resulting in a cleaner, more performant component that better reflects the actual UI pattern.
