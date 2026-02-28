import { Worker, Job } from 'bullmq';
import { logger } from '../utils/logger.js';
import { createBullMQConnection } from './redisConnection.js';
import { getPool } from '../db/pool.js';
import { createV3GamificationRepo } from '../db/repositories/V3GamificationRepo.js';

const EMISSION_CONSTANT = 0.01;
const MAX_ER_ITERATIONS = 20;
const ER_CONVERGENCE_DELTA = 0.001;
const DEFEAT_THRESHOLD = 1.0; // attacking_weight must exceed supportive_weight by this margin
const BOUNTY_MIN_ER = 5.0; // minimum ER for bounty to pay out (Outcome C)
const BOUNTY_WINDFALL_MULTIPLIER = 0.1; // Bounty = |C_A| * |C_B| * windfall_multiplier

const connection = createBullMQConnection('nightly-graph-processor-worker');

export async function processNightlyGraphBatch(job: Job): Promise<void> {
  const pool = getPool();
  const repo = createV3GamificationRepo(pool);

  logger.info('Nightly graph processor: starting batch run');
  const startTime = Date.now();

  // ── Stage 1: Connected Component Tracking ──
  logger.info('Nightly graph processor: Stage 1 — Connected Component Tracking');
  await job.updateProgress(5);

  const [allINodes, allSNodes, allEdges] = await Promise.all([
    repo.loadAllINodes(),
    repo.loadAllSNodes(),
    repo.loadAllEdges(),
  ]);

  logger.info(`Loaded graph: ${allINodes.length} I-nodes, ${allSNodes.length} S-nodes, ${allEdges.length} edges`);

  // Build adjacency: iNodeId -> set of connected iNodeIds via S-nodes
  // Only connect undefeated nodes (start from current state — defeat will be recomputed after ER)
  // Use Union-Find for component detection
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  function find(id: string): string {
    if (!parent.has(id)) { parent.set(id, id); rank.set(id, 0); }
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  }

  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) || 0, rankB = rank.get(rb) || 0;
    if (rankA < rankB) { parent.set(ra, rb); }
    else if (rankA > rankB) { parent.set(rb, ra); }
    else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
  }

  // Initialize all I-nodes in union-find
  for (const node of allINodes) { find(node.id); }

  // Build maps for edge lookup
  // scheme_node_id -> { premise i-node ids, conclusion i-node id }
  const schemeToNodes = new Map<string, { premises: string[]; conclusions: string[] }>();
  for (const edge of allEdges) {
    if (!edge.node_id) continue; // source edges (R-nodes) don't connect I-nodes
    if (!schemeToNodes.has(edge.scheme_node_id)) {
      schemeToNodes.set(edge.scheme_node_id, { premises: [], conclusions: [] });
    }
    const entry = schemeToNodes.get(edge.scheme_node_id)!;
    if (edge.role === 'premise') entry.premises.push(edge.node_id);
    if (edge.role === 'conclusion') entry.conclusions.push(edge.node_id);
  }

  // Union all I-nodes connected via the same S-node
  for (const [, { premises, conclusions }] of schemeToNodes) {
    const allConnected = [...premises, ...conclusions];
    for (let i = 1; i < allConnected.length; i++) {
      const first = allConnected[0];
      const curr = allConnected[i];
      if (first && curr) {
        union(first, curr);
      }
    }
  }

  // Assign component IDs (use root representative as UUID)
  const componentUpdates = allINodes.map(node => ({
    id: node.id,
    component_id: find(node.id),
  }));
  await repo.batchUpdateComponentIds(componentUpdates);

  // Count component sizes
  const componentSizes = new Map<string, number>();
  for (const node of allINodes) {
    const comp = find(node.id);
    componentSizes.set(comp, (componentSizes.get(comp) || 0) + 1);
  }

  // Detect bridge S-nodes (connecting two distinct components) and set escrow
  const sNodeMap = new Map(allSNodes.map(s => [s.id, s]));
  for (const [schemeId, { premises, conclusions }] of schemeToNodes) {
    const sNode = sNodeMap.get(schemeId);
    if (!sNode || sNode.escrow_status !== 'none') continue; // already has escrow

    // Find component roots of premises vs conclusions
    const premiseComps = new Set(premises.map(id => find(id)));
    const conclusionComps = new Set(conclusions.map(id => find(id)));

    // Check if this S-node bridges distinct components
    const allComps = new Set([...premiseComps, ...conclusionComps]);
    if (allComps.size >= 2) {
      // Bridge detected — calculate bounty using component sizes
      const compArray = Array.from(allComps);
      const sizeA = componentSizes.get(compArray[0]!) || 1;
      const sizeB = componentSizes.get(compArray[1]!) || 1;
      const bounty = Math.round(sizeA * sizeB * BOUNTY_WINDFALL_MULTIPLIER);

      if (bounty > 0) {
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
        await repo.setEscrow(schemeId, bounty, expiresAt);
        await repo.setBridgeMetadata(schemeId, compArray[0]!, compArray[1]!);
        logger.info(`Bridge S-node ${schemeId} detected, bounty ${bounty} set`);
      }
    }
  }

  // ── Stage 2: EvidenceRank Computation ──
  logger.info('Nightly graph processor: Stage 2 — EvidenceRank Computation');
  await job.updateProgress(20);

  // Build graph structures for ER computation
  // For each I-node, track supporters and attackers

  // Build support/attack relationships from S-nodes + edges
  // supporter: premise I-node SUPPORTS conclusion I-node via SUPPORT S-node
  // attacker: premise I-node ATTACKS conclusion I-node via ATTACK S-node
  type Relationship = { premiseId: string; conclusionId: string; direction: 'SUPPORT' | 'ATTACK' };
  const relationships: Relationship[] = [];

  for (const [schemeId, { premises, conclusions }] of schemeToNodes) {
    const sNode = sNodeMap.get(schemeId);
    if (!sNode) continue;
    for (const premiseId of premises) {
      for (const conclusionId of conclusions) {
        if (premiseId !== conclusionId) {
          relationships.push({
            premiseId,
            conclusionId,
            direction: sNode.direction,
          });
        }
      }
    }
  }

  // Initialize ER values from current state
  const erValues = new Map<string, number>();
  for (const node of allINodes) {
    // S(v) = vote_score * base_weight
    const seed = Math.max(0, node.vote_score) * node.base_weight;
    erValues.set(node.id, seed);
  }

  // Track which nodes are defeated (start from current, updated per iteration)
  const defeatedSet = new Set<string>(allINodes.filter(n => n.is_defeated).map(n => n.id));

  // Outer defeat-co-resolution loop (max 3 rounds)
  const MAX_OUTER_LOOPS = 3;
  let outerLoop = 0;
  let outerDefeatChanged = true;
  let prevOuterDefeated = new Set<string>(allINodes.filter(n => n.is_defeated).map(n => n.id));

  while (outerLoop < MAX_OUTER_LOOPS && outerDefeatChanged) {
    // Reset defeated set from previous outer round
    defeatedSet.clear();
    for (const id of prevOuterDefeated) defeatedSet.add(id);

    // Inner ER convergence loop
    let innerIterations = 0;
    let innerMaxDelta = Infinity;

    while (innerIterations < MAX_ER_ITERATIONS && innerMaxDelta > ER_CONVERGENCE_DELTA) {
      innerMaxDelta = 0;
      const newErValues = new Map<string, number>();
      // Two-phase: compute new defeat states from PREVIOUS iteration's values,
      // then apply atomically to avoid node-ordering bias.
      const newDefeatedSet = new Set<string>();

      for (const node of allINodes) {
        const seed = Math.max(0, node.vote_score) * node.base_weight;

        // Sum ER of nodes undefeated in the PREVIOUS iteration
        const supportiveER = relationships
          .filter(r => r.conclusionId === node.id && r.direction === 'SUPPORT' && !defeatedSet.has(r.premiseId))
          .reduce((sum, r) => sum + (erValues.get(r.premiseId) || 0), 0);

        const attackingER = relationships
          .filter(r => r.conclusionId === node.id && r.direction === 'ATTACK' && !defeatedSet.has(r.premiseId))
          .reduce((sum, r) => sum + (erValues.get(r.premiseId) || 0), 0);

        const supportiveWeight = seed + supportiveER;
        const attackingWeight = attackingER;

        const isDefeated = attackingWeight > supportiveWeight + DEFEAT_THRESHOLD;
        if (isDefeated) newDefeatedSet.add(node.id);

        const newER = isDefeated ? 0 : Math.max(0, supportiveWeight - attackingWeight);
        newErValues.set(node.id, newER);

        const delta = Math.abs(newER - (erValues.get(node.id) || 0));
        if (delta > innerMaxDelta) innerMaxDelta = delta;
      }

      // Apply both maps atomically after the full pass
      for (const [id, er] of newErValues) {
        erValues.set(id, er);
      }
      defeatedSet.clear();
      for (const id of newDefeatedSet) {
        defeatedSet.add(id);
      }
      innerIterations++;
    }

    // Check if defeat flags changed vs previous outer round
    outerDefeatChanged = false;
    for (const id of defeatedSet) {
      if (!prevOuterDefeated.has(id)) { outerDefeatChanged = true; break; }
    }
    if (!outerDefeatChanged) {
      for (const id of prevOuterDefeated) {
        if (!defeatedSet.has(id)) { outerDefeatChanged = true; break; }
      }
    }

    // Update prevOuterDefeated for next round
    prevOuterDefeated = new Set(defeatedSet);
    outerLoop++;
  }

  logger.info(`EvidenceRank converged after ${outerLoop} outer rounds`);

  // ── Stage 3: Defeat Resolution ──
  logger.info('Nightly graph processor: Stage 3 — Defeat Resolution');
  await job.updateProgress(40);

  // Snapshot previous defeat state
  const previouslyDefeated = await repo.getDefeatedNodeIds();

  // Build ER update list
  const erUpdates = allINodes.map(node => ({
    id: node.id,
    evidence_rank: erValues.get(node.id) || 0,
    is_defeated: defeatedSet.has(node.id),
  }));
  await repo.batchUpdateEvidenceRanks(erUpdates);

  // Find newly defeated nodes (was undefeated, now defeated)
  const newlyDefeated = allINodes.filter(
    node => defeatedSet.has(node.id) && !previouslyDefeated.has(node.id)
  );

  // Generate STREAM_HALTED notifications for authors of newly defeated nodes
  for (const node of newlyDefeated) {
    if (node.author_id) {
      await repo.createEpistemicNotification(node.author_id, 'STREAM_HALTED', {
        i_node_id: node.id,
        content_preview: node.content.slice(0, 120),
        source_type: node.source_type,
        source_id: node.source_id,
      });
    }
  }

  // Find upstream nodes that depended on newly defeated nodes
  if (newlyDefeated.length > 0) {
    const newlyDefeatedIds = newlyDefeated.map(n => n.id);
    const upstreamDeps = await repo.getUpstreamDependents(newlyDefeatedIds);

    for (const dep of upstreamDeps) {
      if (dep.upstream_author_id) {
        await repo.createEpistemicNotification(dep.upstream_author_id, 'UPSTREAM_DEFEATED', {
          upstream_node_id: dep.upstream_node_id,
          defeated_premise_id: dep.defeated_premise_id,
        });
      }
    }
  }

  logger.info(`Defeat resolution: ${newlyDefeated.length} newly defeated nodes, notifications generated`);

  // ── Stage 4: Karma Stream Payout ──
  logger.info('Nightly graph processor: Stage 4 — Karma Stream Payout');
  await job.updateProgress(60);

  // Group undefeated nodes by author and role
  const userKarmaMap = new Map<string, { pioneer: number; builder: number; critic: number }>();

  for (const node of allINodes) {
    if (defeatedSet.has(node.id)) continue; // skip defeated
    if (!node.author_id) continue;
    if (!node.node_role) continue;

    const er = erValues.get(node.id) || 0;
    const yield_ = EMISSION_CONSTANT * er;

    if (!userKarmaMap.has(node.author_id)) {
      userKarmaMap.set(node.author_id, { pioneer: 0, builder: 0, critic: 0 });
    }
    const karma = userKarmaMap.get(node.author_id)!;

    if (node.node_role === 'ROOT') karma.pioneer += yield_;
    else if (node.node_role === 'SUPPORT') karma.builder += yield_;
    else if (node.node_role === 'ATTACK') karma.critic += yield_;
  }

  // Upsert karma profiles and increment user karma
  const karmaIncrements: Array<{ userId: string; pioneer: number; builder: number; critic: number }> = [];
  for (const [userId, yields] of userKarmaMap) {
    await repo.upsertKarmaProfile(userId, { pioneer: yields.pioneer, builder: yields.builder, critic: yields.critic });
    karmaIncrements.push({ userId, ...yields });
  }
  await repo.batchIncrementUserKarma(karmaIncrements);
  logger.info(`Karma payout: ${karmaIncrements.length} users updated`);

  // ── Stage 5: Escrow Clearing ──
  logger.info('Nightly graph processor: Stage 5 — Escrow Clearing');
  await job.updateProgress(75);

  const expiredEscrows = await repo.getExpiredEscrows();
  for (const escrow of expiredEscrows) {
    const er = escrow.evidence_rank;

    if (escrow.is_defeated) {
      // Outcome A: Stolen
      await repo.updateEscrowStatus(escrow.id, 'stolen');
      if (escrow.attacking_author_id) {
        const stolenAmount = Math.floor(escrow.pending_bounty * 0.5);
        await repo.batchIncrementUserKarma([{
          userId: escrow.attacking_author_id,
          pioneer: 0,
          builder: 0,
          critic: stolenAmount,
        }]);
        await repo.createEpistemicNotification(escrow.attacking_author_id, 'BOUNTY_STOLEN', {
          scheme_node_id: escrow.id,
          bounty_earned: stolenAmount,
        });
      }
      if (escrow.author_id) {
        await repo.createEpistemicNotification(escrow.author_id, 'BOUNTY_STOLEN', {
          scheme_node_id: escrow.id,
          bounty_lost: escrow.pending_bounty,
        });
      }
    } else if (er < BOUNTY_MIN_ER) {
      // Outcome B: Languished
      await repo.updateEscrowStatus(escrow.id, 'languished');
      if (escrow.author_id) {
        await repo.createEpistemicNotification(escrow.author_id, 'BOUNTY_LANGUISHED', {
          scheme_node_id: escrow.id,
          evidence_rank: er,
          min_required: BOUNTY_MIN_ER,
        });
      }
    } else {
      // Outcome C: Paid
      await repo.updateEscrowStatus(escrow.id, 'paid');
      if (escrow.author_id) {
        await repo.batchIncrementUserKarma([{
          userId: escrow.author_id,
          pioneer: escrow.pending_bounty,
          builder: 0,
          critic: 0,
        }]);
        await repo.createEpistemicNotification(escrow.author_id, 'BOUNTY_PAID', {
          scheme_node_id: escrow.id,
          bounty_earned: escrow.pending_bounty,
        });
      }
    }
  }
  logger.info(`Escrow clearing: ${expiredEscrows.length} escrows resolved`);

  // ── Stage 6: Source Reputation Update ──
  logger.info('Nightly graph processor: Stage 6 — Source Reputation Update');
  await job.updateProgress(90);

  const sourcesWithCitations = await repo.getSourcesWithCitations();
  const sourceReputationUpdates = sourcesWithCitations.map(source => {
    const survivalRatio = (source.total_er + 1e-6) > 0
      ? source.survived_er / (source.total_er + 1e-6)
      : 1.0;
    // Exponential moving average: 0.9 * current + 0.1 * new_ratio, clamped to [0, 1]
    const currentScore = source.reputation_score ?? 1.0;
    const newScore = Math.max(0.0, Math.min(1.0, 0.9 * currentScore + 0.1 * survivalRatio));
    return { id: source.id, score: newScore };
  });
  await repo.batchUpdateSourceReputation(sourceReputationUpdates);
  logger.info(`Source reputation: ${sourceReputationUpdates.length} domains updated`);

  // Recompute base_weight for FACT nodes citing updated sources
  const iNodeBaseWeightUpdates: Array<{ id: string; base_weight: number }> = [];
  for (const source of sourcesWithCitations) {
    const updatedScore = sourceReputationUpdates.find(u => u.id === source.id)?.score ?? source.reputation_score;
    for (const iNode of allINodes) {
      if (iNode.source_ref_id !== source.id) continue;
      let newBaseWeight = iNode.base_weight;
      if (iNode.fact_subtype === 'DOCUMENT_REF') {
        newBaseWeight = 2.0 + 3.0 * updatedScore; // 2.0 to 5.0
      } else if (iNode.fact_subtype === 'ACADEMIC_REF') {
        newBaseWeight = 5.0 + 5.0 * updatedScore; // 5.0 to 10.0
      }
      if (Math.abs(newBaseWeight - iNode.base_weight) > 0.001) {
        iNodeBaseWeightUpdates.push({ id: iNode.id, base_weight: newBaseWeight });
      }
    }
  }
  if (iNodeBaseWeightUpdates.length > 0) {
    await repo.batchUpdateINodeBaseWeights(iNodeBaseWeightUpdates);
    logger.info(`Base weight recomputed for ${iNodeBaseWeightUpdates.length} I-nodes`);
  }

  const duration = Date.now() - startTime;
  logger.info(`Nightly graph processor: batch complete in ${duration}ms`, {
    iNodes: allINodes.length,
    newlyDefeated: newlyDefeated.length,
    karmaUsers: karmaIncrements.length,
    escrowsResolved: expiredEscrows.length,
    sourcesUpdated: sourceReputationUpdates.length,
  });
  await job.updateProgress(100);
}

export function createNightlyGraphWorker(): Worker {
  const worker = new Worker('nightly-graph-processor', processNightlyGraphBatch, {
    connection,
    concurrency: 1, // Only one nightly run at a time
  });

  worker.on('completed', job => {
    logger.info(`Nightly graph processor: job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Nightly graph processor: job ${job?.id} FAILED`, {
      error: err.message,
    });
  });

  worker.on('error', err => {
    logger.error('Nightly graph processor: fatal error', { error: err.message });
  });

  return worker;
}
