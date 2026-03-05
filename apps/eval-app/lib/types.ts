export interface RankedResult {
  id: string;
  text: string;
  rank: number;
  score: number;
  depth: number;
  parent_id: string | null;
  parent_text?: string | null;
}

export interface ThreadMetrics {
  rr: number;
  ndcg5: number;
  ndcg10: number;
}

export interface ThreadResult {
  test_id: string;
  parent_argument: string;
  delta_comment_ids: string[];
  algorithms: {
    Alg_A: RankedResult[];
    Alg_B: RankedResult[];
  };
  metrics: {
    Alg_A: ThreadMetrics;
    Alg_B: ThreadMetrics;
  };
}

export interface BenchmarkData {
  dataset: string;
  generated_at: string;
  thread_count: number;
  summary: {
    Alg_A: { mrr: number; ndcg5: number; ndcg10: number; win_rate: number };
    Alg_B: { mrr: number; ndcg5: number; ndcg10: number; win_rate: number };
  };
  threads: ThreadResult[];
}

export type Rating = -2 | -1 | 0 | 1 | 2; // -2=Left much better, 2=Right much better

export interface ThreadRating {
  test_id: string;
  rating: Rating; // from Left perspective (which is randomly A or B)
  leftIsAlgA: boolean;
  timestamp: string;
}

export interface EvalSession {
  ratings: Record<string, ThreadRating>; // keyed by test_id
  columnAssignments: Record<string, boolean>; // test_id → leftIsAlgA
}
