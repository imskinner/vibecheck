/**
 * Operational test for "falsifiable". PRD §5.2.1.
 *
 * "MUST be falsifiable" is unenforceable as prose, so it is defined as a check. This module is the
 * CODE half of that check — cheap, deterministic, and unforgiving about the three properties that
 * can be detected lexically. The rubric-graded model pass is the other half and arrives with the
 * generator at M1; neither half is sufficient alone.
 *
 * Statements that fail are REGENERATED, never patched. A model asked to repair its own vague
 * statement reliably just adds adjectives to it.
 */

export type FalsifiabilityRule = 'named_population' | 'observable_predicate' | 'threshold'

export interface FalsifiabilityFailure {
  rule: FalsifiabilityRule
  message: string
}

export interface FalsifiabilityResult {
  ok: boolean
  failures: FalsifiabilityFailure[]
}

/**
 * Population nouns that name no one in particular. Allowed only when qualified — "B2B founders
 * who post weekly" is a population; "founders" is a mood.
 */
const VAGUE_POPULATIONS = [
  'users', 'user', 'people', 'businesses', 'business', 'companies', 'company', 'teams', 'team',
  'customers', 'customer', 'founders', 'developers', 'startups', 'organizations', 'organisations',
  'professionals', 'consumers', 'everyone', 'anyone', 'someone', 'clients', 'buyers', 'markets',
]

/** A vague population noun followed by one of these is being narrowed by a clause. */
const QUALIFYING_FOLLOWERS = [
  'who', 'that', 'which', 'with', 'using', 'managing', 'running', 'billing', 'earning', 'spending',
  'paying', 'posting', 'handling', 'selling', 'shipping', 'in', 'at', 'on', 'over', 'under',
  'from', 'between', 'above', 'below',
]

/** Words that cannot themselves narrow a population, so they do not count as qualifiers. */
const NON_QUALIFYING_PRECEDERS = [
  'the', 'a', 'an', 'some', 'many', 'most', 'all', 'these', 'those', 'their', 'our', 'your', 'its',
  'of', 'and', 'or', 'to', 'for', 'that', 'which', 'are', 'is', 'be', 'been', 'more', 'less',
  'other', 'such', 'any', 'both', 'few', 'several',
]

/**
 * Stated preference and intent. Mom Test rule: past behaviour, not future intent — what someone
 * says they would do is not evidence, so an assumption phrased that way cannot be tested by
 * observation.
 *
 * Note this deliberately does NOT ban forecasts about third parties ("no incumbent ships X within
 * 12 months"). Those are predictions about observable behaviour and are perfectly testable; it is
 * the ICP's self-reported intent that is worthless.
 */
const INTENT_MARKERS: [RegExp, string][] = [
  [/\bwould\b/i, '"would" — asks for a hypothetical, not a past behaviour'],
  [/\bwants?\b|\bwanted\b/i, '"want" — a stated preference, not an observation'],
  [/\bwilling to\b/i, '"willing to" — a stated preference, not an observation'],
  [/\binterested in\b/i, '"interested in" — a stated preference, not an observation'],
  [/\bplans? to\b|\bplanning to\b/i, '"plan to" — an intention, not a behaviour'],
  [/\bintends? to\b/i, '"intend to" — an intention, not a behaviour'],
  [/\bhopes? to\b/i, '"hope to" — an intention, not a behaviour'],
  [/\bprefers?\b/i, '"prefer" — a stated preference, not an observation'],
  [/\bneeds?\b/i, '"need" — asserts a need rather than naming an observable behaviour'],
  [/\bsees? value\b|\bfinds? .* valuable\b/i, '"sees value" — unobservable'],
  [/\bthere is demand\b|\bthere's demand\b/i, '"there is demand" — the canonical unfalsifiable claim'],
]

/** Quantity language. A statement with no quantity has no observation that can contradict it. */
const QUANTIFIER_PHRASES = [
  'at least', 'more than', 'fewer than', 'less than', 'no more than', 'at most', 'under', 'over',
  'above', 'below', 'majority', 'none of', 'no incumbent', 'every', 'each of', 'within',
]

/**
 * Matched on word boundaries, not as substrings. Defends against the quiet false pass: plain
 * `includes('under')` matches "fo-under-", so every statement about a founder was silently
 * credited with a threshold it did not have.
 */
const QUANTIFIER_PATTERN = new RegExp(`\\b(${QUANTIFIER_PHRASES.join('|')})\\b`, 'i')

const tokenize = (statement: string): string[] =>
  statement.toLowerCase().replace(/[^\w\s$%+-]/g, ' ').split(/\s+/).filter(Boolean)

export function checkFalsifiability(statement: string): FalsifiabilityResult {
  const failures: FalsifiabilityFailure[] = []
  const tokens = tokenize(statement)

  // 1. Named population.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token || !VAGUE_POPULATIONS.includes(token)) continue

    const next = tokens[i + 1]
    const previous = tokens[i - 1]
    const narrowedAfter = next !== undefined && QUALIFYING_FOLLOWERS.includes(next)
    const narrowedBefore = previous !== undefined && !NON_QUALIFYING_PRECEDERS.includes(previous)

    if (!narrowedAfter && !narrowedBefore) {
      failures.push({
        rule: 'named_population',
        message: `"${token}" names no specific population — qualify it or say who exactly`,
      })
      break
    }
  }

  // 2. Observable predicate.
  for (const [pattern, message] of INTENT_MARKERS) {
    if (pattern.test(statement)) {
      failures.push({ rule: 'observable_predicate', message })
      break
    }
  }

  // 3. Threshold.
  if (!/\d/.test(statement) && !QUANTIFIER_PATTERN.test(statement)) {
    failures.push({
      rule: 'threshold',
      message: 'no quantity or threshold — nothing observed could contradict this',
    })
  }

  return { ok: failures.length === 0, failures }
}
