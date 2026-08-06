/**
 * Public surface of the scoring module.
 *
 * Nothing in here touches a database, the network, the clock, or an LLM. If an import ever needs
 * to, it belongs somewhere else — /evals must be able to run this without a database, and the
 * eval harness must produce identical numbers on every machine and every run.
 */

export * from './types'
export {
  CAP_FLOOR,
  CAP_SLOPE,
  CATEGORY_TO_SUB_SCORE,
  CONFIDENCE_WEIGHT,
  MODEL_INFERENCE_MAX_SWING,
  SOURCE_WEIGHT,
  SUB_SCORE_WEIGHTS,
} from './constants'
export { scoreLedger } from './composite'
export { assumptionCoverage, evidenceQuality } from './evidence-quality'
export { diffScores, type ScoreMovement } from './movement'
export { assumptionSupport, claimWeight, type SupportResult } from './support'
