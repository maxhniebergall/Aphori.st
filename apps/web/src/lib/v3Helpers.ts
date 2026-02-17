import type {
  V3Subgraph,
  V3INode,
  V3SNode,
  V3Edge,
  V3Enthymeme,
  V3SocraticQuestion,
  V3ExtractedValue,
} from '@chitin/shared';

/** Filter I-nodes for a specific source (post or reply) */
export function filterSubgraphBySource(
  subgraph: V3Subgraph,
  sourceType: 'post' | 'reply',
  sourceId: string
): V3INode[] {
  return subgraph.i_nodes.filter(
    (n) => n.source_type === sourceType && n.source_id === sourceId
  );
}

/** Get all S-nodes connected to an I-node via edges */
export function getConnectedSchemes(
  iNode: V3INode,
  subgraph: V3Subgraph
): Array<{ sNode: V3SNode; edge: V3Edge }> {
  const edges = subgraph.edges.filter(
    (e) => e.node_id === iNode.id && e.node_type === 'i_node'
  );
  return edges
    .map((edge) => {
      const sNode = subgraph.s_nodes.find((s) => s.id === edge.scheme_node_id);
      return sNode ? { sNode, edge } : null;
    })
    .filter((x): x is { sNode: V3SNode; edge: V3Edge } => x !== null);
}

/** Get enthymemes for a given S-node */
export function getEnthymemesForScheme(
  sNodeId: string,
  subgraph: V3Subgraph
): V3Enthymeme[] {
  return subgraph.enthymemes.filter((e) => e.scheme_id === sNodeId);
}

/** Get socratic questions for a given S-node */
export function getSocraticQuestionsForScheme(
  sNodeId: string,
  subgraph: V3Subgraph
): V3SocraticQuestion[] {
  return subgraph.socratic_questions.filter((q) => q.scheme_id === sNodeId);
}

/** Get extracted values for a given I-node */
export function getExtractedValues(
  iNodeId: string,
  subgraph: V3Subgraph
): V3ExtractedValue[] {
  return subgraph.extracted_values.filter((v) => v.i_node_id === iNodeId);
}

interface V3Segment {
  text: string;
  iNode?: V3INode;
}

/** Split text into segments based on I-node spans (same algorithm as V2 segmentText) */
export function segmentTextV3(text: string, iNodes: V3INode[]): V3Segment[] {
  const sorted = [...iNodes].sort((a, b) => a.span_start - b.span_start);
  const segments: V3Segment[] = [];
  let pos = 0;

  for (const iNode of sorted) {
    if (pos < iNode.span_start) {
      segments.push({ text: text.slice(pos, iNode.span_start) });
    }
    segments.push({
      text: text.slice(iNode.span_start, iNode.span_end),
      iNode,
    });
    pos = iNode.span_end;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }

  return segments;
}

export interface EnrichedGhostReply {
  enthymeme: V3Enthymeme;
  sNode: V3SNode;
  parentINode: V3INode | null;
  socraticQuestions: V3SocraticQuestion[];
  /** The source that the parent scheme is connected to */
  sourceType: 'post' | 'reply';
  sourceId: string;
}

/** Walk enthymemes → scheme → edges → source I-nodes to build enriched ghost reply data */
export function getThreadEnthymemes(subgraph: V3Subgraph): EnrichedGhostReply[] {
  const results: EnrichedGhostReply[] = [];

  for (const enthymeme of subgraph.enthymemes) {
    const sNode = subgraph.s_nodes.find((s) => s.id === enthymeme.scheme_id);
    if (!sNode) continue;

    const socraticQuestions = getSocraticQuestionsForScheme(sNode.id, subgraph);

    // Find the I-node connected to this scheme (as conclusion or premise)
    const connectedEdges = subgraph.edges.filter(
      (e) => e.scheme_node_id === sNode.id && e.node_type === 'i_node'
    );
    const parentINode = connectedEdges.length > 0
      ? subgraph.i_nodes.find((n) => n.id === connectedEdges[0]!.node_id) ?? null
      : null;

    // Determine the source from the parent I-node
    const sourceType = parentINode?.source_type ?? 'post';
    const sourceId = parentINode?.source_id ?? '';

    if (!sourceId) continue;

    results.push({
      enthymeme,
      sNode,
      parentINode,
      socraticQuestions,
      sourceType,
      sourceId,
    });
  }

  return results;
}
