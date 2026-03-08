/**
 * CMV Dataset Loader — Webis-CMV-20 format (threads.jsonl)
 *
 * Schema notes from actual data:
 * - Thread has: id, title, selftext, score, delta (bool), comments[]
 * - Comment has: id, body, score, parent_id ("t1_<id>" or "t3_<threadId>"),
 *                author, children[], level
 * - Delta-winning comments identified by DeltaBot children whose body starts
 *   with "Confirmed: 1 delta awarded" and parent_id = "t1_<winnerCommentId>"
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

export interface CMVEdge {
  from_node_id: string;
  to_node_id: string;
}

export interface CMVNode {
  id: string;
  text: string;
  vote_score: number;
}

export interface CMVThread {
  threadId: string;
  focalNodeId: string; // OP post ID
  nodes: CMVNode[];
  edges: CMVEdge[];
  deltaCommentIds: string[]; // comments that earned a Δ
}

interface RawComment {
  id: string;
  body?: string;
  score?: number;
  author?: string;
  parent_id?: string;
  level?: number;
  children?: RawComment[];
}

interface RawThread {
  id: string;
  title?: string;
  selftext?: string;
  score?: number;
  delta?: boolean;
  comments?: RawComment[];
}

/** Strip "t1_" / "t3_" Reddit fullname prefix. */
function stripPrefix(fullname: string): string {
  return fullname.replace(/^t[0-9]+_/, '');
}

/**
 * Walk nested children recursively, collecting all comments into a flat list.
 */
function collectComments(comments: RawComment[], acc: RawComment[]): void {
  for (const c of comments) {
    acc.push(c);
    if (c.children && c.children.length > 0) {
      collectComments(c.children, acc);
    }
  }
}

/**
 * Find comment IDs that were awarded a delta.
 *
 * CMV structure:
 *   Commenter's persuasive argument        ← we want THIS
 *     └─ OP's "Δ Thanks, you changed my view!"  ← DeltaBot's parent
 *          └─ DeltaBot: "Confirmed: 1 delta awarded"
 *
 * So we follow two hops: DeltaBot → OP's acknowledgment → persuasive commenter.
 */
function findDeltaCommentIds(allComments: RawComment[]): string[] {
  // Build a map from comment id → parent_id for the grandparent hop
  const parentOf = new Map<string, string>();
  for (const c of allComments) {
    if (c.id && c.parent_id) parentOf.set(c.id, stripPrefix(c.parent_id));
  }

  const deltaIds = new Set<string>();
  for (const c of allComments) {
    if (
      c.author === 'DeltaBot' &&
      c.body?.startsWith('Confirmed: 1 delta awarded') &&
      c.parent_id?.startsWith('t1_')
    ) {
      // DeltaBot's parent = OP's acknowledgment comment
      const opAckId = stripPrefix(c.parent_id);
      // OP's acknowledgment's parent = the persuasive argument that earned the delta
      const persuasiveId = parentOf.get(opAckId);
      if (persuasiveId) {
        deltaIds.add(persuasiveId);
      }
    }
  }
  return Array.from(deltaIds);
}

function parseThread(raw: RawThread): CMVThread | null {
  if (!raw.delta) return null; // skip threads with no delta awarded

  const focalNodeId = stripPrefix(raw.id);
  const opScore = raw.score ?? 1;
  const opText = `${raw.title ?? ''}\n\n${raw.selftext ?? ''}`.trim();

  if (!opText) return null;

  const opNode: CMVNode = {
    id: focalNodeId,
    text: opText,
    vote_score: opScore,
  };

  const allComments: RawComment[] = [];
  collectComments(raw.comments ?? [], allComments);

  const deltaIds = findDeltaCommentIds(allComments);
  if (deltaIds.length === 0) return null;

  // Collect all valid comment nodes
  const commentNodes: CMVNode[] = [];

  for (const c of allComments) {
    if (!c.id || !c.body || c.body === '[deleted]' || c.body === '[removed]') continue;
    if (c.author === 'DeltaBot') continue; // exclude meta-comments

    commentNodes.push({
      id: c.id,
      text: c.body,
      vote_score: c.score ?? 0,
    });
  }

  // Limit to top 200 comments by vote score, always keeping delta winners
  const MAX_REPLIES = 200;
  let keptComments: CMVNode[];
  if (commentNodes.length <= MAX_REPLIES) {
    keptComments = commentNodes;
  } else {
    const deltaIdSet = new Set(deltaIds);
    const deltaComments = commentNodes.filter(n => deltaIdSet.has(n.id));
    const nonDelta = commentNodes.filter(n => !deltaIdSet.has(n.id));
    nonDelta.sort((a, b) => b.vote_score - a.vote_score);
    const slotsForNonDelta = Math.max(0, MAX_REPLIES - deltaComments.length);
    keptComments = [...deltaComments, ...nonDelta.slice(0, slotsForNonDelta)];
  }

  const nodes: CMVNode[] = [opNode, ...keptComments];
  const edges: CMVEdge[] = [];

  // Build a set of valid comment IDs for edge validation
  const validIds = new Set<string>([focalNodeId]);
  for (const n of keptComments) validIds.add(n.id);

  for (const c of allComments) {
    if (!c.id || !c.parent_id) continue;
    if (c.author === 'DeltaBot') continue;

    const parentId = stripPrefix(c.parent_id);
    if (validIds.has(c.id) && validIds.has(parentId)) {
      edges.push({
        from_node_id: c.id,
        to_node_id: parentId,
      });
    }
  }

  // Filter: need at least 3 comment nodes (excluding OP) and at least 1 delta
  const commentCount = nodes.length - 1; // exclude OP
  if (commentCount < 2) return null;

  // Only include delta IDs that correspond to actual nodes
  const validDeltaIds = deltaIds.filter(id => validIds.has(id));
  if (validDeltaIds.length === 0) return null;

  return {
    threadId: raw.id,
    focalNodeId,
    nodes,
    edges,
    deltaCommentIds: validDeltaIds,
  };
}

/**
 * Loads CMV threads from a file path or directory of JSONL files.
 * Each line is one thread.
 */
export async function loadCMVThreads(
  inputPath: string,
  limit?: number,
  exclude?: Set<string>
): Promise<CMVThread[]> {
  const threads: CMVThread[] = [];

  const stat = fs.statSync(inputPath);
  const files = stat.isFile()
    ? [inputPath]
    : fs.readdirSync(inputPath)
        .filter(f => f.endsWith('.jsonl') || f.endsWith('.json'))
        .map(f => path.join(inputPath, f));

  if (files.length === 0) {
    throw new Error(`No .jsonl or .json files found in ${inputPath}`);
  }

  for (const file of files) {
    if (limit && threads.length >= limit) break;

    const isJsonl = file.endsWith('.jsonl');

    if (isJsonl) {
      const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (limit && threads.length >= limit) break;

        try {
          const raw = JSON.parse(line) as RawThread;
          if (exclude?.has(raw.id)) continue;
          const thread = parseThread(raw);
          if (thread) threads.push(thread);
        } catch {
          // skip malformed lines
        }
      }
    } else {
      const content = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(content);
      const items: RawThread[] = Array.isArray(data) ? data : [data];
      for (const raw of items) {
        if (limit && threads.length >= limit) break;
        if (exclude?.has(raw.id)) continue;
        const thread = parseThread(raw);
        if (thread) threads.push(thread);
      }
    }
  }

  return threads;
}
