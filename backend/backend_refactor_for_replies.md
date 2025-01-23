# Backend Schema Refactor Plan

## Overall Goal
The primary goal is to decouple the storage of original posts (storyTrees) from replies. This involves modifying the data structures, database interactions, and API endpoints to handle posts and replies as distinct entities.

## Phase 1: Data Structure Refactor

1. **Post (StoryTree) Schema:**
   - As defined in `frontend/plan_to_add_comments.txt`, the new `formattedStoryTree` object will have:
     - `id`: UUID of the post.
     - `text`: The main text content of the post.
     - `nodes`: An array of child node IDs (paragraphs).
     - `parentId`: Always `null` for root-level posts.
     - `metadata`: Includes `title`, `author`, `authorId`, `authorEmail`, `createdAt`, and `quote` which will always be `null`.
     - `totalNodes`: The number of child nodes.
   - **Action:** Update the `createStoryTree` endpoint in `backend/server.js` to create this new structure.

2. **Reply Schema:**
   - As defined in `frontend/plan_to_add_comments.txt`, the new `replyObject` will have:
     - `id`: UUID of the reply.
     - `quote`: The quote object that the reply is referencing.
     - `text`: The text content of the reply.
     - `parentId`: An array of parent IDs (initially just the ID of the post being replied to).
     - `metadata`: Includes `author`, `authorId`, `authorEmail`, and `createdAt`.
   - **Action:** Create a new function (e.g., `createReply`) in `backend/server.js` to handle the creation of this new structure.

## Phase 2: Database Interaction Changes

1. **`createStoryTree` Refactor:**
   - Modify the `/api/createStoryTree` endpoint in `backend/server.js` to:
     - Create the new `formattedStoryTree` object.
     - Store the `formattedStoryTree` in Redis.
     - Add the new `uuid` to the `allStoryTreeIds` list.
     - Create a new feed item and add it to the `feedItems` list only if `parentId` is null.
   - **Action:** Refactor the existing `app.post('/api/createStoryTree', ...)` function.

2. **`createReply` Function:**
   - Create a new function in `backend/server.js` to handle reply creation.
   - This function will:
     - Generate a new UUID for the reply.
     - Create the new `replyObject`.
     - Store the `replyObject` in Redis.
     - Add the reply UUID to the appropriate queues for retrieval.
   - **Action:** Create a new function `createReply`.

3. **`getStoryTree` Refactor:**
   - Modify the `/api/storyTree/:uuid` endpoint in `backend/server.js` to:
     - Fetch the `storyTree` object using Redis.
     - Return the `storyTree` object.
   - **Action:** Refactor the existing `app.get('/api/storyTree/:uuid', ...)` function.

4. **New Reply Retrieval Functions:**
   - Create new functions in `backend/server.js` to handle reply retrieval:
     - `getReply(uuid)`: Fetches a single reply object by its UUID.
     - `getReplies(uuid, quote, sortingCriteria)`: Fetches a queue of reply keys for a given post UUID, quote, and sorting criteria.
     - `getRepliesFeed()`: Fetches a queue of reply keys for all replies, sorted by `mostRecent`.
   - **Action:** Create new functions `getReply`, `getReplies`, and `getRepliesFeed`.

## Phase 3: API Endpoint Modifications

1. **New `/api/createReply` Endpoint:**
   - Create a new POST endpoint `/api/createReply` in `backend/server.js`.
   - This endpoint will:
     - Accept the reply data in the request body.
     - Call the `createReply` function to store the reply.
     - Return the new reply's UUID.
   - **Action:** Create a new route `app.post('/api/createReply', ...)`.

2. **New `/api/getReply/:uuid` Endpoint:**
   - Create a new GET endpoint `/api/getReply/:uuid` in `backend/server.js`.
   - This endpoint will:
     - Accept the reply UUID as a parameter.
     - Call the `getReply` function to fetch the reply.
     - Return the reply object.
   - **Action:** Create a new route `app.get('/api/getReply/:uuid', ...)`.

3. **New `/api/getReplies/:uuid/:quote/:sortingCriteria` Endpoint:**
   - Create a new GET endpoint `/api/getReplies/:uuid/:quote/:sortingCriteria` in `backend/server.js`.
   - This endpoint will:
     - Accept the post UUID, quote, and sorting criteria as parameters.
     - Call the `getReplies` function to fetch the reply keys.
     - Return the list of reply keys.
   - **Action:** Create a new route `app.get('/api/getReplies/:uuid/:quote/:sortingCriteria', ...)`.

4. **New `/api/getRepliesFeed` Endpoint:**
   - Create a new GET endpoint `/api/getRepliesFeed` in `backend/server.js`.
   - This endpoint will:
     - Call the `getRepliesFeed` function to fetch the reply keys.
     - Return the list of reply keys.
   - **Action:** Create a new route `app.get('/api/getRepliesFeed', ...)`.

## Phase 4: Seed Script Updates

1. **Modify `seedDevStories` and `seedDefaultStories`:**
   - Update the seed scripts in `backend/seed.js` and `backend/prodSeed.js` to:
     - Create story trees using the new `formattedStoryTree` structure.
     - Not create any replies.
   - **Action:** Refactor `seedDevStories` and `seedDefaultStories`.

## Phase 5: Enhance getReply and getStoryTree to return the existing quotes and counts of replies with that quote
1. 
  - the getReplies, getReply, and getStoryTree functions should all be updated to return a map of quotes to counts of replies to that node with that quote
  - this will allow the frontend to display the existing quotes and counts of replies to that node with that quote
  - we will need to update the createReply function to update the counts of replies to that node with that quote
2. 
 - update the frontend to display the existing quotes and counts of replies to that node with that quote
