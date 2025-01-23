# Frontend Update Plan for Backend Refactor

## General Changes

1. **API Endpoint Updates:** 
   - Update the frontend to use the new API endpoints for replies:
     - `POST /api/createReply` to create a new reply.
     - `GET /api/getReply/:uuid` to fetch a single reply.
     - `GET /api/getReplies/:uuid/:quote/:sortingCriteria` to fetch replies for a specific post and quote.
     - `GET /api/getRepliesFeed` to fetch a feed of all replies.
     - `GET /api/getReplies/:quote/:sortingCriteria` to fetch replies by quote across all posts.

2. **Data Structure Adjustments:** 
   - Adapt to the new data structures for posts (`formattedStoryTree`) and replies (`replyObject`):
     - Posts will no longer have a `quote` property in their metadata.
     - Replies will have a `quote` property, a `parentId` array, and a `metadata` object.

3. **Compression Handling:** 
   - Handle the `X-Data-Compressed` header from the backend and decompress the data accordingly.

## Specific Changes

1. **`StoryTreeContext` Updates:**
   - Update `StoryTreeContext` to include selection state:
     - Add selection range data (start/end positions).
     - Track source post ID.
     - Store quoted text.
     - Track active reply state.

2. **Post Component Updates:**
   - Implement click handlers for word selection and drag selection functionality.
   - Add a "reply mode" visual state.

3. **Selection UI:**
   - Create highlight styling for selected text.
   - Implement drag handles for selection modification.
   - Handle drag events for selection modification.

4. **Reply Composer Updates:**
   - Add a quote preview section.
   - Connect the quote preview to the selection state.
   - Handle selection persistence.

5. **API Call Modifications:**
   - Update the `createStoryTree` API call to not include quote data.
   - Create a new API call to `POST /api/createReply` with the new reply schema.
   - Update the `getStoryTree` API call to handle the new `formattedStoryTree` structure and the `X-Data-Compressed` header.
   - Create new API calls to fetch replies using the new endpoints:
     - `GET /api/getReply/:uuid`
     - `GET /api/getReplies/:uuid/:quote/:sortingCriteria`
     - `GET /api/getRepliesFeed`
     - `GET /api/getReplies/:quote/:sortingCriteria`

6. **Reply Display Logic:**
   - Update the logic for displaying replies within the `StoryTree` component.
   - Highlight text that has replies.
   - Implement the functionality to display replies when the highlighted text is clicked.

7. **Data Fetching and Caching:**
   - Update data fetching logic to use the new API endpoints and data structures.
   - Ensure that the frontend can handle compressed data from the backend.

8. **UI Updates:**
   - Update the UI to show the different levels of the story tree:
     - Initial posts should be linked by a column on the left.
     - Replies to initial posts should be linked by an indented column on the left.
     - Viewing replies to replies should open a new "replies" page.

## File Modifications

Based on the above, here are the files that will likely need modifications:

- `frontend/src/contexts/StoryTreeContext.tsx` (or similar): To manage selection state.
- `frontend/src/components/StoryTreeNode.tsx` (or similar): To handle selection and display replies.
- `frontend/src/components/ReplyComposer.tsx` (or similar): To handle reply creation and quote preview.
- `frontend/src/api/apiClient.ts` (or similar): To update API calls.
- `frontend/src/components/VirtualizedStoryList.tsx` (or similar): To handle the new data structures and compression.
- Potentially other components that display or interact with story trees and replies.

This plan provides a structured approach to updating the frontend in response to the backend refactor.
