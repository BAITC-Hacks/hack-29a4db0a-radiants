import { normalizeDataset, roleProfileKey, type NormalizedDataset } from "../data/normalize";
import { getNextSession, getUnmetPrerequisites, matchesAudience, SNAPSHOT_DATE } from "./eligibility";
import {
  GRADES,
  type ActivityRecord,
  type CareerDataset,
  type DevelopmentEvent,
  type Employee,
  type EmployeeView,
  type ExpectedChange,
  type Grade,
  type Recommendation,
  type RoleProfile,
  type Skill,
  type SkillGap,
  type SkillLevel,
} from "../../types/career";

export { SNAPSHOT_DATE } from "./eligibility";
const RECENT_HISTORY_DAYS = 365;

export type RecommendationExclusionCode = "mandatory" | "audience" | "prerequisites" | "unavailable" | "completed" | "in_progress" | "no_gap_reduction";
export interface RecommendationExclusion { code: RecommendationExclusionCode; message: string }
export interface RecommendationDiagnostics {
  status: "available" | "needs_career_goal" | "target_reached" | "no_eligible_events";
  summary: string;
  snapshotDate: string;
  catalogEventCount: number;
  evaluatedEventCount: number;
  eligibleEventCount: number;
  remainingGapCount: number;
  /** Each evaluated event is counted once, against its first failing rule. */
  exclusionCounts: Record<RecommendationExclusionCode, number>;
  /** At most ten voluntary audience-matching activities that could reduce a current gap. */
  blockedEvents: Array<{ eventId: string; title: string; reasons: RecommendationExclusion[] }>;
  readinessExplanation: { formula: string; criticalWeight: 2; standardWeight: 1; precision: 1 };
}

interface Candidate extends Recommendation {
  criticalGapLevelsClosed: number;
  totalGapLevelsClosed: number;
}

interface HistorySignal {
  adjustment: number;
  text: string;
}

export function getEmployeeView(dataset: NormalizedDataset, employeeId: string): EmployeeView {
  const employee = dataset.employeeById.get(employeeId);
  if (!employee) {
    throw new Error(`Unknown employee: ${employeeId}`);
  }

  const target = resolveTarget(employee, dataset);
  const effectiveSkills = reconstructEffectiveSkills(employee, dataset);

  if (!target) {
    return {
      employee,
      target: null,
      targetStatus: "needs_career_goal",
      effectiveSkills,
      readiness: 0,
      skillGaps: [],
      recommendations: [],
    };
  }

  const profile = dataset.roleProfileByKey.get(roleProfileKey(target.role, target.grade));
  if (!profile) {
    throw new Error(`Missing role profile for ${target.role} ${target.grade}`);
  }

  const skillGaps = calculateSkillGaps(profile, effectiveSkills, dataset);
  const readiness = calculateReadiness(skillGaps);
  const history = dataset.historyByEmployeeId.get(employee.employee_id) ?? [];
  const recommendations = dataset.events
    .map((event) => toCandidate(event, employee, target, profile, effectiveSkills, history, dataset))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort(compareCandidates)
    .slice(0, 3)
    .map(({ criticalGapLevelsClosed: _critical, totalGapLevelsClosed: _total, ...recommendation }) => recommendation);

  return {
    employee,
    target,
    targetStatus: "active",
    effectiveSkills,
    readiness,
    skillGaps,
    recommendations,
  };
}

export function getRecommendations(
  employee: Employee,
  history: ActivityRecord[],
  events: DevelopmentEvent[],
  roleProfiles: RoleProfile[],
  skills: Skill[],
): EmployeeView {
  const dataset = normalizeDataset({
    employees: [employee],
    history,
    events,
    roleProfiles,
    skills,
  });

  return getEmployeeView(dataset, employee.employee_id);
}

/** Explain the same eligibility checks used for recommendations without relaxing them. */
export function getRecommendationDiagnostics(dataset: NormalizedDataset, employeeId: string): RecommendationDiagnostics {
  const view = getEmployeeView(dataset, employeeId);
  const diagnostics: RecommendationDiagnostics = {
    status: "needs_career_goal",
    summary: "A career goal is needed before the next development step can be selected.",
    snapshotDate: SNAPSHOT_DATE,
    catalogEventCount: dataset.events.length,
    evaluatedEventCount: 0,
    eligibleEventCount: 0,
    remainingGapCount: view.skillGaps.filter((gap) => gap.gap > 0).length,
    exclusionCounts: { mandatory: 0, audience: 0, prerequisites: 0, unavailable: 0, completed: 0, in_progress: 0, no_gap_reduction: 0 },
    blockedEvents: [],
    readinessExplanation: {
      formula: "Readiness = 100 × sum(weight × min(current level / required level, 1)) / sum(weight), rounded to one decimal. Critical skills have weight 2; other skills have weight 1. A zero requirement counts as fulfilled; no requirements means 100%. Without a career target, readiness is 0%.",
      criticalWeight: 2,
      standardWeight: 1,
      precision: 1,
    },
  };
  if (!view.target) return diagnostics;

  const profile = dataset.roleProfileByKey.get(roleProfileKey(view.target.role, view.target.grade))!;
  const history = dataset.historyByEmployeeId.get(employeeId) ?? [];
  diagnostics.evaluatedEventCount = dataset.events.length;
  for (const event of dataset.events) {
    const reasons = eligibilityExclusions(event, view.employee, view.target, view.effectiveSkills, history, getNextSession(event), dataset.skillById);
    const { totalGapLevelsClosed } = simulateEvent(event, profile, view.effectiveSkills);
    if (totalGapLevelsClosed === 0) {
      reasons.push({ code: "no_gap_reduction", message: "This activity would not reduce any remaining target skill gap at the current skill levels and teaching caps." });
    }
    if (reasons.length === 0) {
      diagnostics.eligibleEventCount++;
      continue;
    }
    diagnostics.exclusionCounts[reasons[0].code]++;
    if (totalGapLevelsClosed > 0 && !event.mandatory && matchesAudience(event, view.employee, view.target)) {
      diagnostics.blockedEvents.push({ eventId: event.event_id, title: event.title, reasons });
    }
  }
  diagnostics.blockedEvents.sort((left, right) => left.eventId.localeCompare(right.eventId));
  diagnostics.blockedEvents = diagnostics.blockedEvents.slice(0, 10);
  if (diagnostics.remainingGapCount === 0) {
    diagnostics.status = "target_reached";
    diagnostics.summary = "All skill requirements for the current career target are met. Readiness is a development indicator, not a promotion decision.";
  } else if (diagnostics.eligibleEventCount > 0) {
    diagnostics.status = "available";
    diagnostics.summary = `${diagnostics.eligibleEventCount} eligible voluntary activity or activities can reduce current target skill gaps; up to three are shown.`;
  } else {
    diagnostics.status = "no_eligible_events";
    diagnostics.summary = `${diagnostics.remainingGapCount} target skill gaps remain, but the current catalog has no eligible voluntary activity that reduces them. Completed non-repeatable activities, prerequisites, audience and availability rules still apply.`;
  }
  return diagnostics;
}

export function resolveTarget(
  employee: Employee,
  dataset: Pick<NormalizedDataset, "roleProfileByKey">,
): { role: string; grade: Grade } | null {
  if (employee.career_goal) {
    return {
      role: employee.career_goal.target_role,
      grade: employee.career_goal.target_grade,
    };
  }

  const nextGrade = GRADES[GRADES.indexOf(employee.grade) + 1];
  if (!nextGrade || !dataset.roleProfileByKey.has(roleProfileKey(employee.role, nextGrade))) {
    return null;
  }

  return { role: employee.role, grade: nextGrade };
}

export function reconstructEffectiveSkills(
  employee: Employee,
  dataset: Pick<NormalizedDataset, "eventById" | "historyByEmployeeId">,
): Record<string, SkillLevel> {
  const effectiveSkills: Record<string, SkillLevel> = {};
  for (const [skillId, level] of Object.entries(employee.skills)) {
    if (level !== undefined) {
      effectiveSkills[skillId] = level;
    }
  }
  const history = dataset.historyByEmployeeId.get(employee.employee_id) ?? [];

  for (const record of history) {
    if (record.status !== "completed" || record.date <= employee.last_review_date) {
      continue;
    }

    const event = dataset.eventById.get(record.event_id);
    if (!event) {
      continue;
    }

    for (const effect of event.develops_skills) {
      const currentLevel = effectiveSkills[effect.skill_id] ?? 0;
      effectiveSkills[effect.skill_id] = applySkillGain(currentLevel, effect.gain, effect.max_level);
    }
  }

  return effectiveSkills;
}

export function calculateSkillGaps(
  profile: RoleProfile,
  effectiveSkills: Record<string, SkillLevel>,
  dataset: Pick<NormalizedDataset, "skillById">,
): SkillGap[] {
  return Object.entries(profile.required_skills)
    .map(([skillId, requiredLevel]) => {
      const currentLevel = effectiveSkills[skillId] ?? 0;
      return {
        skillId,
        name: dataset.skillById.get(skillId)?.name ?? skillId,
        currentLevel,
        projectedLevel: currentLevel,
        requiredLevel,
        gap: Math.max(0, requiredLevel - currentLevel),
        critical: profile.critical_skills.includes(skillId),
      };
    })
    .sort((left, right) => Number(right.critical) - Number(left.critical) || right.gap - left.gap || left.name.localeCompare(right.name));
}

export function calculateReadiness(skillGaps: SkillGap[]): number {
  const totalWeight = skillGaps.reduce((sum, gap) => sum + (gap.critical ? 2 : 1), 0);
  if (totalWeight === 0) {
    return 100;
  }

  const satisfiedWeight = skillGaps.reduce((sum, gap) => {
    const fulfillment = gap.requiredLevel === 0 ? 1 : Math.min(gap.currentLevel / gap.requiredLevel, 1);
    return sum + fulfillment * (gap.critical ? 2 : 1);
  }, 0);
  return Math.round((satisfiedWeight / totalWeight) * 1000) / 10;
}

function toCandidate(
  event: DevelopmentEvent,
  employee: Employee,
  target: { role: string; grade: Grade },
  profile: RoleProfile,
  effectiveSkills: Record<string, SkillLevel>,
  history: ActivityRecord[],
  dataset: NormalizedDataset,
): Candidate | null {
  const nextSession = getNextSession(event);
  if (!isEligible(event, employee, target, effectiveSkills, history, nextSession)) {
    return null;
  }

  const { expectedChanges, criticalGapLevelsClosed, totalGapLevelsClosed } = simulateEvent(
    event,
    profile,
    effectiveSkills,
  );
  if (totalGapLevelsClosed === 0) {
    return null;
  }

  const historySignal = calculateHistorySignal(event, history, dataset.eventById);
  const score = criticalGapLevelsClosed * 40 + (totalGapLevelsClosed - criticalGapLevelsClosed) * 10 + historySignal.adjustment;
  const reasons = buildReasons(expectedChanges, profile, dataset, historySignal.text);
  const availability = nextSession ? `Next session: ${nextSession}.` : "Available self-paced.";
  const targetLabel = `${target.role} ${target.grade}`;
  const changesText = expectedChanges
    .filter((change) => change.before !== change.after)
    .map((change) => `${dataset.skillById.get(change.skillId)?.name ?? change.skillId} ${change.before}->${change.after}`)
    .join(", ");

  return {
    eventId: event.event_id,
    title: event.title,
    score,
    reasons,
    expectedChanges,
    historySignal: historySignal.text,
    ...(nextSession ? { nextSession } : {}),
    deterministicExplanation: `${event.title} advances the ${targetLabel} trajectory by changing ${changesText}. ${historySignal.text} ${availability}`,
    explanationSource: "fallback",
    criticalGapLevelsClosed,
    totalGapLevelsClosed,
  };
}

function isEligible(
  event: DevelopmentEvent,
  employee: Employee,
  target: { role: string; grade: Grade },
  skills: Record<string, SkillLevel>,
  history: ActivityRecord[],
  nextSession: string | undefined,
): boolean {
  return eligibilityExclusions(event, employee, target, skills, history, nextSession).length === 0;
}

function eligibilityExclusions(
  event: DevelopmentEvent,
  employee: Employee,
  target: { role: string; grade: Grade },
  skills: Record<string, SkillLevel>,
  history: ActivityRecord[],
  nextSession: string | undefined,
  skillById?: Map<string, Skill>,
): RecommendationExclusion[] {
  const reasons: RecommendationExclusion[] = [];
  if (event.mandatory) reasons.push({ code: "mandatory", message: "Mandatory obligations are shown separately and are never career recommendations." });
  if (!matchesAudience(event, employee, target)) reasons.push({ code: "audience", message: "The activity does not match the employee's current or target role and grade." });
  const missingPrerequisites = getUnmetPrerequisites(event, skills);
  if (missingPrerequisites.length > 0) {
    const missing = missingPrerequisites
      .map(({ skillId, current, required }) => `${skillById?.get(skillId)?.name ?? skillId}: current ${current}, required ${required}`);
    reasons.push({ code: "prerequisites", message: `Prerequisites are not met: ${missing.join("; ")}.` });
  }
  if (event.format !== "self_paced" && !nextSession) reasons.push({ code: "unavailable", message: `No scheduled session is available on or after ${SNAPSHOT_DATE}.` });
  const recordsForEvent = history.filter((record) => record.event_id === event.event_id);
  if (event.event_id !== "EV_036" && recordsForEvent.some((record) => record.status === "completed")) {
    reasons.push({ code: "completed", message: "This activity is already completed and cannot be repeated. Only EV_036 allows repeated completion." });
  }
  if (recordsForEvent.some((record) => record.status === "in_progress")) {
    reasons.push({ code: "in_progress", message: "This activity is already in progress and is not offered as a new step." });
  }
  return reasons;
}

function simulateEvent(
  event: DevelopmentEvent,
  profile: RoleProfile,
  effectiveSkills: Record<string, SkillLevel>,
): { expectedChanges: ExpectedChange[]; criticalGapLevelsClosed: number; totalGapLevelsClosed: number } {
  let criticalGapLevelsClosed = 0;
  let totalGapLevelsClosed = 0;
  const expectedChanges = event.develops_skills.map((effect) => {
    const before = effectiveSkills[effect.skill_id] ?? 0;
    const after = applySkillGain(before, effect.gain, effect.max_level);
    const required = profile.required_skills[effect.skill_id] ?? 0;
    const critical = profile.critical_skills.includes(effect.skill_id);
    const closed = Math.max(0, Math.min(after, required) - Math.min(before, required));
    totalGapLevelsClosed += closed;
    if (critical) {
      criticalGapLevelsClosed += closed;
    }
    return { skillId: effect.skill_id, before, after, required, critical };
  });

  return { expectedChanges, criticalGapLevelsClosed, totalGapLevelsClosed };
}

function calculateHistorySignal(
  event: DevelopmentEvent,
  history: ActivityRecord[],
  eventById: Map<string, DevelopmentEvent>,
): HistorySignal {
  let topicPenalty = 0;
  let formatPenalty = 0;
  let topicNegativeCount = 0;
  let formatNegativeCount = 0;
  let assignedDeclines = 0;
  let comparableCount = 0;
  const matchingFeedback: number[] = [];
  const skillIds = new Set(event.develops_skills.filter((effect) => effect.gain > 0).map((effect) => effect.skill_id));

  for (const record of history) {
    if (!isRecent(record.date)) {
      continue;
    }
    const historicalEvent = eventById.get(record.event_id);
    if (!historicalEvent || historicalEvent.type !== event.type || historicalEvent.format !== event.format) {
      continue;
    }
    const relatedTopic = historicalEvent.event_id === event.event_id ||
      historicalEvent.develops_skills.some((effect) => effect.gain > 0 && skillIds.has(effect.skill_id));
    if (relatedTopic) comparableCount++;
    if (["no_show", "dropped", "declined"].includes(record.status)) {
      const assignedDecline = record.status === "declined" && record.assigned_by !== "self";
      if (assignedDecline) assignedDeclines++;
      if (relatedTopic) {
        topicNegativeCount++;
        topicPenalty += assignedDecline ? 5 : 10;
      } else {
        formatNegativeCount++;
        formatPenalty += assignedDecline ? 1 : 2;
      }
    }
    if (relatedTopic && record.status === "completed" && record.feedback_rating !== null) {
      matchingFeedback.push(record.feedback_rating);
    }
  }

  const averageFeedback = matchingFeedback.length
    ? matchingFeedback.reduce((sum, rating) => sum + rating, 0) / matchingFeedback.length
    : null;
  const feedbackAdjustment = averageFeedback === null ? 0 : averageFeedback >= 4 ? 5 : averageFeedback <= 2 ? -5 : 0;
  // Shared delivery format is weak evidence when the activities teach unrelated skills.
  const penalty = Math.min(30, topicPenalty + Math.min(6, formatPenalty));
  const adjustment = -penalty + feedbackAdjustment;
  const parts: string[] = [];
  if (topicNegativeCount) {
    parts.push(`${topicNegativeCount} recent participation signal(s) on related skills and this format reduce suitability.`);
  }
  if (formatNegativeCount) {
    parts.push(`${formatNegativeCount} format-only negative record(s) on unrelated topics have limited weight.`);
  }
  if (assignedDeclines) {
    parts.push(`${assignedDeclines} externally assigned decline(s) receive reduced weight; this is not a motivation assessment.`);
  }
  if (feedbackAdjustment > 0) {
    parts.push("Positive feedback on related skills in this format supports this activity.");
  } else if (feedbackAdjustment < 0) {
    parts.push("Low feedback on related skills in this format reduces suitability.");
  }
  if (parts.length === 0) {
    parts.push(comparableCount
      ? `${comparableCount} recent comparable participation record(s), with no negative signal or strong feedback adjustment.`
      : "No recent comparable participation records; evidence is insufficient to infer a preference.");
  }
  return { adjustment, text: parts.join(" ") };
}

function isRecent(date: string): boolean {
  const milliseconds = Date.parse(SNAPSHOT_DATE) - Date.parse(date);
  return milliseconds >= 0 && milliseconds <= RECENT_HISTORY_DAYS * 24 * 60 * 60 * 1000;
}

function buildReasons(
  changes: ExpectedChange[],
  profile: RoleProfile,
  dataset: NormalizedDataset,
  historySignal: string,
): string[] {
  const impactReasons = changes
    .filter((change) => change.required > change.before)
    .map((change) => {
      const name = dataset.skillById.get(change.skillId)?.name ?? change.skillId;
      const label = change.critical ? "critical" : "target";
      return `${name}: ${change.before}->${change.after} toward required ${change.required} (${label} skill).`;
    });
  return [
    `Supports requirements for ${profile.role} ${profile.grade}.`,
    ...impactReasons,
    historySignal,
  ];
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    right.score - left.score ||
    right.criticalGapLevelsClosed - left.criticalGapLevelsClosed ||
    sessionSortValue(left.nextSession).localeCompare(sessionSortValue(right.nextSession)) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function sessionSortValue(session: string | undefined): string {
  return session ?? "9999-12-31";
}

function applySkillGain(current: SkillLevel, gain: number, maxLevel: SkillLevel): SkillLevel {
  // An activity's teaching cap limits growth, not an already attained skill level.
  const level = Math.max(current, Math.min(current + gain, maxLevel));
  return Math.max(0, Math.min(5, Math.round(level))) as SkillLevel;
}
