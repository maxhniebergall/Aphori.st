// User Types
export type UserType = 'human' | 'agent';

export interface User {
  id: string;
  email: string;
  user_type: UserType;
  display_name: string | null;
  pioneer_karma: number;
  builder_karma: number;
  critic_karma: number;
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
export interface Post {
  id: string;
  author_id: string;
  title: string;
  content: string;
  analysis_content_hash: string;
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
  content: string;
  rewritten_text: string | null;
  epistemic_type: V3EpistemicType;
  fvp_confidence: number;
  span_start: number;
  span_end: number;
  extraction_confidence: number;
  created_at: string;
  fact_subtype: 'ENTHYMEME' | 'ANECDOTE' | 'DOCUMENT_REF' | 'ACADEMIC_REF' | null;
  base_weight: number;
  evidence_rank: number;
  is_defeated: boolean;
  component_id: string | null;
  node_role: 'ROOT' | 'SUPPORT' | 'ATTACK' | null;
}

export interface V3SNode {
  id: string;
  analysis_run_id: string;
  direction: V3SchemeDirection;
  logic_type: string | null;
  confidence: number;
  gap_detected: boolean;
  fallacy_type: string | null;
  fallacy_explanation: string | null;
  created_at: string;
  escrow_expires_at: string | null;
  pending_bounty: number | null;
  escrow_status: 'none' | 'active' | 'paid' | 'stolen' | 'languished';
}

export interface V3Edge {
  id: string;
  scheme_node_id: string;
  node_id: string | null;
  node_type: V3NodeType;
  role: V3EdgeRole;
  source_id: string | null;
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
  high_variance_terms?: string[];
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

// V3 Concept Node Types
export interface V3ConceptNode {
  id: string;
  term: string;
  definition: string;
  created_at: string;
}

export interface V3INodeConceptMapping {
  i_node_id: string;
  concept_id: string;
  term_text: string;
  created_at: string;
}

export interface V3EquivocationFlag {
  id: string;
  scheme_node_id: string;
  term: string;
  premise_i_node_id: string;
  conclusion_i_node_id: string;
  premise_concept_id: string;
  conclusion_concept_id: string;
  created_at: string;
}

// Investigate Page Types
export interface InvestigateFocalNode {
  id: string;
  content: string;
  rewritten_text: string | null;
  epistemic_type: V3EpistemicType;
  fvp_confidence: number;
  source_type: 'post' | 'reply';
  source_id: string;
  source_post_id: string;
  source_title: string | null;
  source_author: string | null;
  source_author_id: string | null;
}

export interface InvestigateThreadNode {
  i_node_id: string;
  content: string;
  rewritten_text: string | null;
  epistemic_type: V3EpistemicType;
  fvp_confidence: number;
  source_type: 'post' | 'reply';
  source_id: string;
  source_post_id: string;
  source_title: string | null;
  source_author: string | null;
  source_author_id: string | null;
  relation: V3SchemeDirection;
  scheme_id: string;
  scheme_confidence: number;
  evidence_rank: number;
  hinge_centrality: number;
  final_score: number;
  cluster_id: number;
  extracted_values: string[];
}

export interface InvestigateGhostNode {
  id: string;
  content: string;
  fvp_type: V3EpistemicType;
  probability: number;
  scheme_id: string;
  scheme_direction: V3SchemeDirection;
  socratic_question: string | null;
  uncertainty_level: number;
}

export interface InvestigateResponse {
  focal_node: InvestigateFocalNode;
  synthetic_thread: InvestigateThreadNode[];
  ghost_nodes: InvestigateGhostNode[];
  total_related: number;
  computation_metadata: {
    nodes_analyzed: number;
    clusters_formed: number;
  };
}

// V4 Gamification Types

export type V3FactSubtype = 'ENTHYMEME' | 'ANECDOTE' | 'DOCUMENT_REF' | 'ACADEMIC_REF';
export type V3NodeRole = 'ROOT' | 'SUPPORT' | 'ATTACK';
export type V3EscrowStatus = 'none' | 'active' | 'paid' | 'stolen' | 'languished';
export type V3SourceLevel = 'DOMAIN' | 'DOCUMENT' | 'EXTRACT';
export type V3EpistemicNotificationType = 'STREAM_HALTED' | 'BOUNTY_STOLEN' | 'BOUNTY_PAID' | 'BOUNTY_LANGUISHED' | 'UPSTREAM_DEFEATED';

export interface V3UserKarmaProfile {
  user_id: string;
  daily_pioneer_yield: number;
  daily_builder_yield: number;
  daily_critic_yield: number;
  last_batch_run_at: string | null;
  updated_at: string;
  // Totals from users table (joined)
  pioneer_karma: number;
  builder_karma: number;
  critic_karma: number;
}

export type EpistemicNotificationType =
  | 'STREAM_HALTED' | 'BOUNTY_STOLEN' | 'BOUNTY_PAID'
  | 'BOUNTY_LANGUISHED' | 'UPSTREAM_DEFEATED';

export type UnifiedNotification =
  | (NotificationWithContext & { category: 'SOCIAL' })
  | {
      category: 'EPISTEMIC';
      id: string;
      user_id: string;
      epistemic_type: EpistemicNotificationType;
      payload: Record<string, unknown>;
      is_read: boolean;
      created_at: string;
      updated_at: string;
    };

export interface V3Source {
  id: string;
  level: V3SourceLevel;
  url: string | null;
  title: string | null;
  parent_source_id: string | null;
  reputation_score: number;
  created_at: string;
  updated_at: string;
}

export interface V3KarmaNode {
  id: string;
  content: string;
  rewritten_text: string | null;
  epistemic_type: V3EpistemicType;
  node_role: V3NodeRole;
  base_weight: number;
  evidence_rank: number;
  is_defeated: boolean;
  source_type: 'post' | 'reply';
  source_id: string;
}

export interface V3ActiveBounty {
  scheme_node_id: string;
  pending_bounty: number;
  escrow_expires_at: string;
  escrow_status: V3EscrowStatus;
  // Bridge info
  component_a_sample: string | null;  // sample I-node content from component A
  component_b_sample: string | null;  // sample I-node content from component B
}
