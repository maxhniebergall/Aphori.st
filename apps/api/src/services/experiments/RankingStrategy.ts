export interface GraphNode {
  id: string;
  text: string;
  basic_strength: number; // [0,1] normalized
  vote_score: number;
  user_karma: number;
  embedding?: number[];
}

export interface GraphEdge {
  from_node_id: string;
  to_node_id: string;
  direction: 'SUPPORT' | 'ATTACK';
  confidence: number;
}

export interface RankedResult {
  id: string;
  text: string;
  rank: number;
  score: number;
}

export interface RankingStrategy {
  name: string;
  rank(nodes: GraphNode[], edges: GraphEdge[], focalNodeId: string): RankedResult[];
}
