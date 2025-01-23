# Enhancing TextSelection Component for Quote Visualization

## Overall Approach

1. **Props:** Receive a `quotes` prop (the map of quotes to counts of replies) in the `TextSelection` component.
2. **DOM Manipulation:** Use DOM manipulation (similar to the existing highlight logic) to render the quote highlights. This avoids React re-renders during the highlighting process.
3. **Highlighting:** Render quote highlights in green, with darkening for overlapping areas.
4. **Click Handling:** Augment the existing click/touch functionality to handle clicks on quote highlights.
5. **Quote Cycling:** Implement quote cycling for overlapping highlights, ordered by reply count.
6. **Context Update:** Update the `StoryTreeContext` with the selected quote when a highlight is clicked.
7. **Maintain Existing UX:** Ensure that the existing text selection functionality remains intact.

## Detailed Implementation

1. **Receiving Quotes:**
   - The `TextSelection` component will receive a `quotes` prop, which is a map of `{ start, end }` objects to reply counts.
   - The `TextSelection` component should sort the quotes by reply count, and only include the top 10.

2. **Rendering Highlights:**
   - Use DOM manipulation to iterate through the `quotes` prop and render light green highlights for each quote.
   - Create a new function, `highlightQuotes`, similar to `highlightText`, that takes the `quotes` map and applies the highlights.
   - For overlapping highlights, adjust the background color to darken the green. This can be achieved by layering multiple semi-transparent green spans.

3. **Click Handling:**
   - Modify the `handleSelectionCompleted` function to check if the click occurred on a quote highlight.
   - We will need to determine that the mouseUp was a click, not a drag using `isDraggingRef.current`
   - If the click occurred on a highlight, determine which quote(s) are associated with that highlight.
   - If there are multiple overlapping quotes, implement a cycling mechanism to select the next quote in the order of reply count.
   - Update the `StoryTreeContext` with the selected quote using the `SET_QUOTE_METADATA` action.
   - If the click did not occur on a highlight, maintain the existing text selection functionality.

4. **Quote Cycling:**
   - Maintain a local state (using `useRef` to avoid re-renders) to track the currently selected quote index for each overlapping area.
   - When a highlight is clicked, increment the index and select the next quote in the list, wrapping around to the beginning if necessary.
   - Use DOM manipulation to change the background color of the selected quote to light blue.

5. **Avoiding Re-renders:**
   - Continue to use DOM manipulation for highlighting and unhighlighting text.
   - Use `useRef` for any local state that doesn't need to trigger re-renders.
