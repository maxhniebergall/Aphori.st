# Design Document: Markdown Rendering and Text Highlighting in NodeContent

## 1. Initial Goal

The primary goal was to enhance the `NodeContent` component to display user-generated content as markdown, while preserving the existing text highlighting functionality. This functionality included:
- Highlighting segments of text that correspond to existing quotes made by child replies (green background/border).
- Highlighting the specific quote being replied to (blue/teal underline).
- Allowing users to click on highlighted segments to cycle through overlapping quotes.
- Displaying hover previews for quotes.

## 2. Chosen Approach for Markdown Rendering

To render markdown content within the `NodeContent` component (specifically, in its child `HighlightedText` component), the decision was made to use the `MDEditor.Markdown` component from the `@uiw/react-md-editor` library. This library was already in use for the `ReplyEditor` component.

The `HighlightedText.tsx` component was modified to:
- Import `MDEditor` and its associated CSS.
- Use `<MDEditor.Markdown source={text} />` to render the input `text` prop.
- Temporarily remove props and internal logic related to plain-text based highlighting (`selections`, `quoteCounts`, `onSegmentClick`, `selectedReplyQuote`, `segments`, etc.).

The `NodeContent.tsx` component was updated accordingly:
- To stop passing the removed props to `HighlightedText`.
- To simplify the `React.memo` comparison function for `HighlightedText`.
- To comment out the `useHighlighting` hook and related logic, as its outputs were no longer consumed by `HighlightedText`.

## 3. Challenge: Integrating Highlighting with Rendered Markdown

The core challenge arose from the fact that the existing highlighting system was based on character offsets (start/end numbers) within a *plain text* string. When markdown is rendered:
- It's converted into an HTML structure (e.g., `# Header` becomes `<h1>Header</h1>`).
- The original plain text character offsets no longer directly or simply map to this generated HTML structure. A single quote selection might span across multiple HTML elements or be nested within them.

Simply rendering markdown first and then attempting to overlay highlights based on the original text offsets is not feasible with the current `HighlightedText` segmentation logic.

## 4. Proposed Solution for Future Re-integration

To achieve both markdown rendering and the desired highlighting functionality, a more integrated approach is necessary. The recommended solution involves:

1.  **Leveraging `rehype` Plugins**: The `@uiw/react-md-editor` (and its underlying markdown processing libraries like `remark`/`rehype`) allows for plugins that can transform the content during different stages of parsing and rendering. A custom `rehype` plugin would be the most robust solution.
2.  **Plugin Functionality**:
    *   The `rehype` plugin would operate on the HTML Abstract Syntax Tree (HAST) generated from the markdown.
    *   HAST nodes often retain positional information (start/end character offsets) mapping back to the original markdown source string.
    *   The plugin would traverse the HAST, focusing on text nodes.
    *   For each text node, it would compare its source offset range against the `selectionRange` of the `Quote` objects (from `useHighlighting`) that need to be highlighted.
    *   If a `Quote`'s range overlaps, the plugin would split the text node and wrap the relevant parts in `<span>` elements with specific CSS classes for highlighting (e.g., `.highlight-existing-quote`, `.highlight-reply-quote`).
    *   These `<span>`s could also receive `data-*` attributes (e.g., `data-quote-ids`) to help re-attach interactivity.
3.  **Re-integrating Interactivity**:
    *   `NodeContent.tsx` would reinstate the `useHighlighting` hook.
    *   `HighlightedText.tsx` would receive the quote data and pass it to the `rehype` plugin.
    *   Event delegation or custom React renderers for the generated `<span>`s (via `MDEditor.Markdown`'s component override props) could be used to handle `onClick` and `onMouseEnter`/`onMouseLeave` events, thereby restoring the interactive highlighting features.

## 5. Decision: Temporarily Remove Highlighting Functionality

Given the complexity of implementing the `rehype` plugin and reintegrating the interactive highlighting features with rendered markdown, the decision has been made to **temporarily remove the advanced text highlighting functionality** from `NodeContent`.

The priority is to first enable correct markdown rendering. The advanced highlighting can be revisited and implemented in the future using the strategy outlined above.

This decision was partially motivated out of discontent with the result of implementing the highlighting functionality. The result was pretty ugly, and probably confusing. There were lots of bright colours, everything was being highglighted, overlapping highlights were confusing, etc. I can't relaly see this component existing in the long term. 

In the long term, I think we will not want to allow users to select the quotes to be displayed, and we will have to just pick the ones which seem most interesting to the user. Similarly, we might allow the users to search for replies, and display replies based on that.

## 6. Current State of Affected Components (as of this decision)

*   **`frontend/src/components/HighlightedText.tsx`**:
    *   Renders its `text` prop using `<MDEditor.Markdown source={text} />`.
    *   No longer accepts props for `selections`, `quoteCounts`, `onSegmentClick`, or `selectedReplyQuote`.
    *   All internal logic related to segmenting text and handling highlight interactivity has been removed/commented out.
*   **`frontend/src/components/NodeContent.tsx`**:
    *   Passes only the `text` prop (from `node.textContent`) to `MemoizedHighlightedText`.
    *   The `useHighlighting` hook and its associated state/callbacks are commented out, as they are no longer used by `HighlightedText`.
    *   The custom `React.memo` comparison function for `MemoizedHighlightedText` has been simplified to only compare the `text` prop.

This approach ensures that content is displayed as markdown, with the understanding that the nuanced highlighting features are deferred.
