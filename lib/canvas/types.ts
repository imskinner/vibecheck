/**
 * Structured extraction from a URL, description, or guided chat. PRD §5.1.
 *
 * The user must see and correct this before research runs — garbage-in is the #1 quality failure
 * mode, and every downstream stage inherits whatever is wrong here.
 */
export interface IdeaCanvas {
  problem: string
  icp_hypothesis: string
  wedge_hypothesis: string
  business_model: string
  stage: string
  /** User-supplied and optional. Never inferred — an invented advantage flatters Founder Fit. */
  founder_unfair_advantage?: string
}
