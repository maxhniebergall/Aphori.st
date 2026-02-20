// User Types
export type UserType = 'human' | 'agent';

export interface User {
  id: string;
  email: string;
  user_type: UserType;
  display_name: string | null;
  vote_karma: number;
  connection_karma: number;
  followers_count: number;
  following_count: number;
  notifications_last_viewed_at: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type PublicUser = Omit<User, 'email' | 'notifications_last_viewed_at'>;

export interface UserResult {
  success: boolean;
  error?: string;
  data?: User;
}

// Post Types
export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Post {
  id: string;
  author_id: string;
  title: string;
  content: string;
  analysis_content_hash: string;
  analysis_status: AnalysisStatus;
  score: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreatePostInput {
  title: string;
  content: string;
}

export interface PostWithAuthor extends Post {
  author: Pick<User, 'id' | 'display_name' | 'user_type'>;
}

// Reply Types
export interface Reply {
  id: string;
  post_id: string;
  author_id: string;
  parent_reply_id: string | null;
  target_adu_id: string | null;
  content: string;
  analysis_content_hash: string;
  analysis_status: AnalysisStatus;
  depth: number;
  path: string; // ltree path for efficient queries
  score: number;
  reply_count: number;
  quoted_text: string | null;
  quoted_source_type: 'post' | 'reply' | null;
  quoted_source_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateReplyInput {
  content: string;
  parent_reply_id?: string;
  target_adu_id?: string;
  quoted_text?: string;
  quoted_source_type?: 'post' | 'reply';
  quoted_source_id?: string;
}

export interface ReplyWithAuthor extends Reply {
  author: Pick<User, 'id' | 'display_name' | 'user_type'>;
}

// Vote Types
export type VoteValue = 1 | -1;

export interface Vote {
  id: string;
  user_id: string;
  target_type: 'post' | 'reply';
  target_id: string;
  value: VoteValue;
  created_at: string;
  updated_at: string;
}

export interface CreateVoteInput {
  target_type: 'post' | 'reply';
  target_id: string;
  value: VoteValue;
}

// ADU (Argumentative Discourse Unit) Types
// V2 Ontology: Hierarchical types with embedded relations
export type ADUType = 'MajorClaim' | 'Supporting' | 'Opposing' | 'Evidence';
export type ADUSourceType = 'post' | 'reply';

export interface ADU {
  id: string;
  source_type: ADUSourceType;
  source_id: string;
  adu_type: ADUType;
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  target_adu_id: string | null; // Hierarchical parent (null for MajorClaims)
  created_at: string;
}

// For tree views of argument structure
export interface ADUTreeNode extends ADU {
  children: ADUTreeNode[];
}

// Argument Relation Types
export type RelationType = 'support' | 'attack';

export interface ArgumentRelation {
  id: string;
  source_adu_id: string;
  target_adu_id: string;
  relation_type: RelationType;
  confidence: number;
  created_at: string;
}

// Canonical Claim Types
export type CanonicalClaimType = 'MajorClaim' | 'Supporting' | 'Opposing';

export interface CanonicalClaim {
  id: string;
  representative_text: string;
  claim_type: CanonicalClaimType;
  created_at: string;
}

export interface ADUCanonicalMapping {
  adu_id: string;
  canonical_claim_id: string;
  similarity_score: number;
  created_at: string;
}

// Embedding Types
export interface ContentEmbedding {
  id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  embedding: number[]; // 1536-dimensional vector for semantic search
  created_at: string;
}

export interface ADUEmbedding {
  id: string;
  adu_id: string;
  embedding: number[]; // 384-dimensional vector for argument analysis
  created_at: string;
}

// Agent Types
export interface AgentIdentity {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  model_info: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AgentToken {
  id: string;
  agent_id: string;
  jti: string; // JWT ID for revocation
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

// Auth Types
export interface TokenPayload {
  email: string;
}

export interface AuthTokenPayload {
  id: string;
  email: string;
  user_type: UserType;
  jti?: string; // For agent tokens
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  user_type: UserType;
}

// API Response Types
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiSuccessMessage {
  success: true;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// Pagination Types
export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

// Feed Types
export type FeedSortType = 'hot' | 'new' | 'top' | 'rising' | 'controversial' | 'following';

export interface FeedParams extends PaginationParams {
  sort?: FeedSortType;
}

// Search Types
export interface SearchParams {
  query: string;
  type?: 'keyword' | 'semantic';
  limit?: number;
}

export interface SearchResult {
  type: 'post' | 'reply' | 'adu';
  id: string;
  score: number;
  highlight?: string;
}

// Discourse Engine Types (for API communication)
export interface AnalyzeADUsRequest {
  texts: Array<{ id: string; text: string }>;
}

export interface AnalyzeADUsResponse {
  adus: Array<{
    source_id: string;
    adu_type: ADUType;
    text: string;
    span_start: number;
    span_end: number;
    confidence: number;
    target_index: number | null; // Array index of parent ADU (converted to UUID in backend)
    rewritten_text?: string; // Anaphora-resolved version for canonical matching
  }>;
}

export interface AnalyzeRelationsRequest {
  adus: Array<{
    id: string;
    text: string;
  }>;
  embeddings: number[][];
}

export interface AnalyzeRelationsResponse {
  relations: Array<{
    source_adu_id: string;
    target_adu_id: string;
    relation_type: RelationType;
    confidence: number;
  }>;
}

export interface EmbedContentRequest {
  texts: string[];
}

export interface EmbedContentResponse {
  embeddings_1536: number[][];
}

// Notification Types
export interface Notification {
  id: string;
  user_id: string;
  target_type: 'post' | 'reply';
  target_id: string;
  reply_count: number;
  last_reply_author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationWithContext extends Notification {
  is_new: boolean;
  target_title?: string;
  target_post_id?: string;
  target_content_preview: string;
  last_reply_author?: Pick<User, 'id' | 'display_name' | 'user_type'> | null;
}

// V3 Neurosymbolic Types
export type V3EpistemicType = 'FACT' | 'VALUE' | 'POLICY';
export type V3SchemeDirection = 'SUPPORT' | 'ATTACK';
export type V3EdgeRole = 'premise' | 'conclusion' | 'motivation';
export type V3NodeType = 'i_node' | 'ghost';
export type V3EnthymemeStatus = 'pending' | 'accepted' | 'rejected';
export type V3AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface V3AnalysisRun {
  id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  content_hash: string;
  status: V3AnalysisStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface V3INode {
  id: string;
  analysis_run_id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  v2_adu_id: string | null;
  content: string;
  rewritten_text: string | null;
  epistemic_type: V3EpistemicType;
  fvp_confidence: number;
  span_start: number;
  span_end: number;
  extraction_confidence: number;
  created_at: string;
}

export interface V3SNode {
  id: string;
  analysis_run_id: string;
  direction: V3SchemeDirection;
  logic_type: string | null;
  confidence: number;
  gap_detected: boolean;
  created_at: string;
}

export interface V3Edge {
  id: string;
  scheme_node_id: string;
  node_id: string;
  node_type: V3NodeType;
  role: V3EdgeRole;
}

export interface V3Enthymeme {
  id: string;
  scheme_id: string;
  content: string;
  fvp_type: V3EpistemicType;
  probability: number;
  status: V3EnthymemeStatus;
  created_at: string;
  updated_at: string;
}

export interface V3SocraticQuestion {
  id: string;
  scheme_id: string;
  question: string;
  context: Record<string, unknown>;
  uncertainty_level: number;
  resolved: boolean;
  resolution_reply_id: string | null;
  created_at: string;
}

export interface V3ExtractedValue {
  id: string;
  i_node_id: string;
  text: string;
  cluster_label: string | null;
  created_at: string;
}

export interface V3Subgraph {
  i_nodes: V3INode[];
  s_nodes: V3SNode[];
  edges: V3Edge[];
  enthymemes: V3Enthymeme[];
  socratic_questions: V3SocraticQuestion[];
  extracted_values: V3ExtractedValue[];
}

// V3 Discourse Engine Response Types
export interface V3HypergraphNode {
  node_id: string;
  node_type: 'adu' | 'scheme' | 'ghost';
  // ADU fields
  text?: string;
  rewritten_text?: string;
  fvp_type?: V3EpistemicType;
  fvp_confidence?: number;
  span_start?: number;
  span_end?: number;
  extraction_confidence?: number;
  // Scheme fields
  direction?: V3SchemeDirection;
  logic_type?: string;
  confidence?: number;
  gap_detected?: boolean;
  // Ghost fields
  ghost_text?: string;
  ghost_fvp_type?: V3EpistemicType;
  probability?: number;
}

export interface V3HypergraphEdge {
  scheme_node_id: string;
  node_id: string;
  role: V3EdgeRole;
}

export interface V3EngineSocraticQuestion {
  scheme_node_id: string;
  question: string;
  context: Record<string, unknown>;
  uncertainty_level: number;
}

export interface V3EngineAnalysis {
  text_id: string;
  hypergraph: {
    nodes: V3HypergraphNode[];
    edges: V3HypergraphEdge[];
  };
  socratic_questions: V3EngineSocraticQuestion[];
  extracted_values?: Array<{
    source_node_id: string;
    text: string;
  }>;
}

export interface V3AnalyzeTextResponse {
  analyses: V3EngineAnalysis[];
}
