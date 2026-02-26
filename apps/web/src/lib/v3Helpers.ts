import type {
  V3Subgraph,
  V3INode,
  V3SNode,
  V3Edge,
  V3ExtractedValue,
} from '@chitin/shared';

/** Returns the set of I-node IDs that are not the conclusion of any SUPPORT scheme edge */
export function getUnsupportedINodeIds(subgraph: V3Subgraph): Set<string> {
  const sNodeById = new Map(subgraph.s_nodes.map(s => [s.id, s] as const));
  const supportedIds = new Set(
    subgraph.edges
      .filter(e => e.role === 'conclusion' && e.node_type === 'i_node')
      .filter(e => sNodeById.get(e.scheme_node_id)?.direction === 'SUPPORT')
      .map(e => e.node_id)
  );
  return new Set(
    subgraph.i_nodes
      .filter(i => !supportedIds.has(i.id))
      .map(i => i.id)
  );
}

/** Returns a map from I-node ID to fallacy info for I-nodes that are conclusions of fallacious scheme edges */
export function getFallaciousINodeIds(
  subgraph: V3Subgraph
): Map<string, { type: string; explanation: string }> {
  const result = new Map<string, { type: string; explanation: string }>();
  for (const sNode of subgraph.s_nodes) {
    if (sNode.fallacy_type && sNode.fallacy_type !== 'NONE') {
      const conclusionEdge = subgraph.edges.find(
        e => e.scheme_node_id === sNode.id && e.role === 'conclusion' && e.node_type === 'i_node'
      );
      if (conclusionEdge) {
        // Assumption: at most one fallacious S-node per I-node conclusion.
        // If multiple fallacious S-nodes share a conclusion, last-write-wins.
        result.set(conclusionEdge.node_id, {
          type: sNode.fallacy_type,
          explanation: sNode.fallacy_explanation ?? '',
        });
      }
    }
  }
  return result;
}

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
    if (iNode.span_end <= pos) continue; // fully overlapped by a previous span, skip
    // NOTE: effectiveStart may differ from iNode.span_start when spans partially overlap.
    // The span metadata on the iNode represents the original extraction range, but we render
    // from effectiveStart to avoid re-rendering already-covered text. This is a display-only
    // approximation and does not affect the iNode's stored span values.
    const effectiveStart = Math.max(iNode.span_start, pos);
    if (pos < effectiveStart) {
      segments.push({ text: text.slice(pos, effectiveStart) });
    }
    segments.push({
      text: text.slice(effectiveStart, iNode.span_end),
      iNode,
    });
    pos = iNode.span_end;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }

  return segments;
}

