## Design Document: Vector Search for Posts and Replies (Revised)

**Last Updated:** May 12, 2025

**1. Introduction and Goals**

This document outlines the design for implementing vector search capabilities for posts and replies within the Aphorist platform. The primary goal is to allow users to find relevant content based on semantic similarity. Vectors will be stored in Firebase Realtime Database (RTDB), and search operations will be performed by a FAISS index running in the Cloud Run backend instance.

**2. Current Architecture Overview**

The existing backend architecture uses Firebase Realtime Database for data storage, with a Node.js backend running on Cloud Run. Key data entities like `posts` and `replies` are stored in dedicated paths within RTDB.

* **Posts**: Stored under `/posts/$postId`.
* **Replies**: Stored under `/replies/$replyId`.
* **API Endpoints**: CRUD operations are handled via Express routes (e.g., `POST /api/posts/createPost`, `POST /api/replies/createReply`).
* **Database Client**: `FirebaseClient.ts` handles direct interactions with RTDB.
* **IDs**: Posts and replies use condensed UUID7 IDs.

**3. Proposed Vector Search Architecture**

The proposed architecture will introduce:

* **Vector Embeddings Generation**: Using Vertex AI to convert content into numerical vector embeddings.
* **Sharded Vector Storage in RTDB**: A new data structure in RTDB to store these embeddings, sharded into lists.
* **FAISS Index Management**: Logic in Cloud Run to load vectors from RTDB into a FAISS index and update it incrementally.
* **Simplified Search API Endpoint**: A new API endpoint for vector searches with fixed parameters.

**4. Detailed Design**

**4.1. Vector Embeddings Generation**

* **Embedding Model**:
    * **Choice**: We will use the `gemini-embedding-exp-03-07` model via the Vertex AI API.
    * **Implementation**: The backend will include a service to call the Vertex AI API for embedding generation.
* **Generation Trigger**:
    * **New Content**: Embeddings will be generated online when a new post or reply is created. This will occur within the `createPost` and `createReply` API handlers.
    * **Existing Content (Backfill)**: The `migrate.ts` script will be rewritten to generate embeddings for all existing posts and replies and populate the vector storage in RTDB.
    * **Future Optimization**: Investigate batch embedding generation via Vertex AI API in the future to potentially reduce costs for large volumes.
* **Immutability**: There will be no updating or deleting of posts, replies, or their corresponding vectors. This simplifies the system as vector regeneration or deletion logic is not required post-creation.

**4.2. Vector Storage in Firebase RTDB**

* **Combined Index**: Posts and replies will be combined into a single logical index for vector search purposes.
* **Sharded List Structure for Vectors**:
    * A new root path, e.g., `/vectorIndexStore/`, will be created.
    * Under this path, vectors will be stored in sharded lists (Firebase nodes acting as lists). Each list will have a maximum capacity (e.g., 10,000 entries).
    * A separate metadata node, e.g., `/vectorIndexMetadata/`, will track the current active list for writing and potentially the sequence of lists.

    ```json
    {
      "vectorIndexStore": {
        "shard_0": { // First list of vectors
          "$contentId_1": { /* vector data */ },
          "$contentId_2": { /* vector data */ },
          // ... up to 10,000 entries
        },
        "shard_1": { // Second list, created when shard_0 is full
          "$contentId_10001": { /* vector data */ },
          // ...
        }
        // ... more shards as needed
      },
      "vectorIndexMetadata": {
        "activeWriteShard": "shard_1", // Key of the current shard for new entries
        "shardCapacity": 10000,
        "totalVectorCount": 10500, // Global counter for all vectors stored
        "shards": { // Information about each shard
            "shard_0": { "count": 10000, "createdAt": "timestamp" },
            "shard_1": { "count": 500, "createdAt": "timestamp" }
        }
      }
    }
    ```
* **Vector Data Entry Structure (within each shard list)**:
    * The key for each entry will be the `$contentId` (the existing condensed UUID7 ID of the post or reply).

    ```json
    // Example entry under /vectorIndexStore/shard_X/$contentId
    {
      "vector": [0.123, 0.456, ..., 0.789], // The numerical vector from Gemini
      "type": "post" | "reply",             // Type of the original content
      "createdAt": "ISO8601_Timestamp_String" // Timestamp of vector creation
      // originalId is the $contentId itself, so no need for a separate field
    }
    ```
* **Writing Vectors and Managing Shards**:
    * The `FirebaseClient.ts` will need new methods:
        * `addVector(contentId: string, vectorData: any): Promise<void>`: This method will:
            1.  Read `/vectorIndexMetadata` to find the `activeWriteShard` and its current `count`.
            2.  If the current shard is at capacity (e.g., 10,000 entries), it will create a new shard (e.g., `shard_N+1`), update `activeWriteShard` to the new shard key, and initialize its count in `/vectorIndexMetadata/shards/`.
            3.  Write the vector data to `/vectorIndexStore/CURRENT_SHARD_KEY/$contentId`.
            4.  Increment the count for the current shard and the `totalVectorCount` in `/vectorIndexMetadata/` (ideally in a transaction).
* **Reading Vectors for FAISS Index**:
    * On Cloud Run instance startup, the backend will read `/vectorIndexMetadata` to get the list of all shard keys (e.g., by iterating through keys in `/vectorIndexMetadata/shards/`).
    * It will then fetch entries from all shards under `/vectorIndexStore/` up to a configured maximum (initially 10,000 total objects for the FAISS index) to build the initial FAISS index. If `totalVectorCount` exceeds this limit, a warning will be logged.

**4.3. FAISS Index Management in Cloud Run**

* **FAISS Library**: We will use `faiss-node`. FAISS will run in the same Cloud Run container instance as the backend.
* **Index Type**: A flat index (e.g., `IndexFlatL2` for L2 distance, or `IndexFlatIP` for inner product if more suitable for Gemini embeddings) will be used.
* **Index Loading & Initial Build**:
    * On Cloud Run instance startup, the backend will:
        1.  Fetch vector data from RTDB (from all shards in `/vectorIndexStore/`, respecting the maximum object limit for the in-memory index).
        2.  Build the FAISS index in memory. This index will map FAISS's internal sequential IDs (0 to N-1) back to our `$contentId`.
    * The maximum number of objects to load into the FAISS index will be configurable (initially 10,000) to prevent Out-Of-Memory (OOM) errors in the container.
    * If the `totalVectorCount` in `/vectorIndexMetadata` exceeds this configured maximum, a warning will be logged, indicating that not all vectors are being indexed in FAISS.
* **Index Updates (Incremental)**:
    * For each new post or reply:
        1.  The backend generates the embedding.
        2.  The embedding is added to the live in-memory FAISS index.
        3.  The embedding and its metadata are stored in the appropriate shard in RTDB under `/vectorIndexStore/`.
    * These two operations (FAISS add + RTDB write) should be robust.
* **Graceful Shutdown**:
    * The Cloud Run backend instance will need to be configured to handle `SIGTERM` signals to allow "in-flight" operations (like storing newly generated embeddings to RTDB and adding to FAISS) to complete before shutting down. This might involve tracking active operations and delaying shutdown for a short period.
* **No Separate Index Storage**: The FAISS index will be rebuilt from RTDB on each instance startup. Given the index size is expected to be small (<10,000 objects), persisting the FAISS index itself to external storage is not required for this phase.

**4.4. Search API Endpoint**

* **New Endpoint**: `GET /api/search/vector`
* **Request Parameters**:
    * `query`: The search text string. (Required)
* **Fixed Parameters**:
    * `k` (number of results) will be fixed at 10.
    * No filtering by `type` (post/reply) at the API or search level.
    * No pagination will be implemented initially.
* **Processing**:
    1.  Backend receives the `query`.
    2.  Generates a vector embedding for the `query` text using the Gemini model via Vertex AI.
    3.  Queries the in-memory FAISS index to find the 10 nearest neighbors.
    4.  FAISS returns indices and distances. The backend maps these FAISS indices to the `$contentId`s.
    5.  Retrieves the full post or reply data for these `$contentId`s by first checking the `type` field stored with the vector and then using the appropriate `FirebaseClient.ts` method (`getPost()` or `getReply()`).
    6.  Formats and returns the results.
* **Response Structure**:

    ```typescript
    interface VectorSearchResponse {
      success: boolean;
      results: Array<{
        id: string; // $contentId (original condensed UUID7 of post or reply)
        type: "post" | "reply"; // Type of the original content
        score: number; // Similarity score/distance from FAISS
        data: PostData | ReplyData; // Full post or reply object, fetched using 'type'
      }>;
      error?: string;
    }
    ```

**4.5. Data Flow Summary**

1.  **Content Creation**:
    * User creates a post/reply.
    * API handler saves content to `/posts` or `/replies`.
    * API handler generates vector embedding (Vertex AI) and gets `$contentId` and `type`.
    * API handler adds vector to in-memory FAISS index.
    * API handler saves vector, `type`, and `createdAt` to the current active shard in `/vectorIndexStore/` and updates `/vectorIndexMetadata/`.
2.  **FAISS Index Building (Cloud Run Startup)**:
    * Cloud Run instance reads `/vectorIndexMetadata`.
    * Reads vector data from all shards in `/vectorIndexStore/` (up to max FAISS index limit).
    * Builds/rebuilds the in-memory FAISS index.
3.  **Search**:
    * User search triggers `GET /api/search/vector`.
    * Backend generates query embedding.
    * Queries in-memory FAISS index.
    * Fetches full content details for results from `/posts` or `/replies` based on the `type` field associated with the vector.
    * Returns 10 results.

**5. Backend File Changes**

* **`FirebaseClient.ts`**:
    * Update/Add `addVectorToShard(contentId: string, vectorData: any, metadata: { activeWriteShard: string, newShardKey?: string, totalVectorCount: number, currentShardCount: number }): Promise<void>` (handles multi-location update for vector and metadata).
    * Add `getVectorIndexMetadata(): Promise<any | null>`
    * Add `getAllVectorsFromShards(shardKeys: string[], faissIndexLimit: number): Promise<Array<{id: string, vector: number[], type: string}>>`
* **`routes/posts.ts` & `routes/replies.ts`**:
    * Modify `createPost` and `createReply`:
        * After saving content, generate embedding.
        * Call new service method to add to FAISS and RTDB vector store.
* **New File: `routes/search.ts`**:
    * Implement `GET /api/search/vector`.
* **New File: `services/vectorService.ts`**:
    * Embedding generation (Vertex AI client).
    * FAISS index management (init, add, search).
    * Logic for determining current write shard and creating new shards by interacting with `FirebaseClient`.
* **`server.ts`**:
    * Initialize `VectorService`, trigger initial FAISS index build.
    * Implement graceful shutdown logic.
* **`migrate.ts`**:
    * Rewrite to backfill embeddings:
        * Read existing posts/replies.
        * Generate embeddings via `VectorService`.
        * Store them in `/vectorIndexStore/` using the sharding logic.
* **`types/index.ts`**:
    * Add `VectorSearchResponse`, `VectorIndexEntry` (for `/vectorIndexStore/`), `VectorIndexMetadata`.

**6. Database Rules (`database.rules.json`)**

* **RTDB Access**: All RTDB paths (`/users`, `/posts`, `/replies`, `/vectorIndexStore`, `/vectorIndexMetadata`, etc.) will only be accessible via the backend service account. Client-side read/write will be disallowed.
    * This means general `.read` and `.write` rules at the root or for major data paths should be `false` or restricted to backend authentication if a specific mechanism for service account auth through rules is used (more commonly, service accounts bypass rules when using Admin SDK). Assuming Admin SDK bypasses, the key is no public rules.
* **Specific Rules for Vector Paths**:

    ```json
    {
      "rules": {
        // ... existing rules, ensure they are backend-only or false for client access ...
        ".read": false, // Default deny for clients
        ".write": false, // Default deny for clients

        "vectorIndexStore": {
          // No direct client read/write. Backend uses Admin SDK.
          // Validation can still be useful if backend writes might be complex.
          "$shardId": {
            "$contentId": {
              ".validate": "newData.hasChildren(['vector', 'type', 'createdAt']) && newData.child('vector').isList() && newData.child('type').isString() && (newData.child('type').val() === 'post' || newData.child('type').val() === 'reply') && newData.child('createdAt').isString()"
              // Note: isList() is a conceptual check; actual validation for array of numbers is limited.
              // Backend must ensure correct vector format.
            }
          }
        },
        "vectorIndexMetadata": {
          // No direct client read/write.
          ".validate": "newData.hasChildren(['activeWriteShard', 'shardCapacity', 'totalVectorCount', 'shards']) && newData.child('activeWriteShard').isString() && newData.child('shardCapacity').isNumber() && newData.child('totalVectorCount').isNumber() && newData.child('shards').isObject()"
          // Further validation for structure of 'shards' object if needed.
        }
        // Ensure /posts, /replies, etc. are also not client-readable/writable if not already set.
      }
    }
    ```

**7. Scalability and Future Considerations**

* **RTDB Shard Management**: Reading from many small shards to build the FAISS index could become inefficient.
* **FAISS Index Limit**: The 10,000 object limit for the in-memory FAISS index is a hard cap for this design. Beyond this, not all content will be searchable.
* **Vertex AI Costs**: Monitor online embedding generation costs. Batching will be important later.
* **Dedicated Vector Database**: The current design is a step towards a more robust solution. Future migration to Vertex AI Vector Search or another dedicated vector DB will be necessary for larger scale.

**8. Implementation Plan (High-Level)**

1.  **Vertex AI Integration**: Set up Vertex AI client in `VectorService` for `gemini-embedding-exp-03-07`.
2.  **RTDB Sharding Logic**: Implement sharding logic in `FirebaseClient.ts` and `VectorService` for `/vectorIndexStore/` and `/vectorIndexMetadata/`.
3.  **Update RTDB Rules**: Secure RTDB access for backend only.
4.  **FAISS Index (Cloud Run)**:
    * Integrate `faiss-node` in `VectorService`.
    * Implement index build on startup (reading from shards, respecting 10k limit).
    * Implement incremental add to FAISS.
5.  **Content Creation Flow**: Update `createPost`/`createReply` to use `VectorService`.
6.  **Search API**: Implement `GET /api/search/vector`.
7.  **`migrate.ts`**: Rewrite for backfill with sharding.
8.  **Graceful Shutdown**: Implement in `server.ts`.
9.  **Testing**: End-to-end testing.
10. **Frontend Integration**.

This revised document incorporates your specific requirements and provides a more detailed path forward.