import { normalizeDataset, roleProfileKey, type NormalizedDataset } from "../data/normalize";
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

export const SNAPSHOT_DATE = "2026-10-01";
const RECENT_HISTORY_DAYS = 365;

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
      effectiveSkills[effect.skill_id] = toSkillLevel(Math.min(currentLevel + effect.gain, effect.max_level));
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

  const satisfiedWeight = skillGaps.reduce(
    (sum, gap) => sum + (gap.gap === 0 ? (gap.critical ? 2 : 1) : 0),
    0,
  );
  return Math.round((satisfiedWeight / totalWeight) * 100);
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
  if (event.mandatory || !matchesAudience(event, employee, target) || !meetsPrerequisites(event, skills)) {
    return false;
  }
  if (event.format !== "self_paced" && !nextSession) {
    return false;
  }

  const recordsForEvent = history.filter((record) => record.event_id === event.event_id);
  return !recordsForEvent.some(
    (record) => record.status === "in_progress" || (record.status === "completed" && event.event_id !== "EV_036"),
  );
}

function matchesAudience(
  event: DevelopmentEvent,
  employee: Employee,
  target: { role: string; grade: Grade },
): boolean {
  const includes = (role: string, grade: Grade) =>
    event.target_roles.includes(role) && event.target_grades.includes(grade);
  return includes(employee.role, employee.grade) || includes(target.role, target.grade);
}

function meetsPrerequisites(event: DevelopmentEvent, skills: Record<string, SkillLevel>): boolean {
  return Object.entries(event.prerequisites).every(
    ([skillId, requiredLevel]) => (skills[skillId] ?? 0) >= (requiredLevel ?? 0),
  );
}

function getNextSession(event: DevelopmentEvent): string | undefined {
  if (event.format === "self_paced" && event.upcoming_sessions.length === 0) {
    return undefined;
  }
  return event.upcoming_sessions.filter((session) => session >= SNAPSHOT_DATE).sort()[0];
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
    const after = Math.min(before + effect.gain, effect.max_level);
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
  let penalty = 0;
  const matchingFeedback: number[] = [];

  for (const record of history) {
    if (!isRecent(record.date)) {
      continue;
    }
    const historicalEvent = eventById.get(record.event_id);
    if (!historicalEvent || historicalEvent.type !== event.type || historicalEvent.format !== event.format) {
      continue;
    }
    if (["no_show", "dropped", "declined"].includes(record.status)) {
      penalty = Math.max(-30, penalty - 10);
    }
    if (record.status === "completed" && record.feedback_rating !== null) {
      matchingFeedback.push(record.feedback_rating);
    }
  }

  const averageFeedback = matchingFeedback.length
    ? matchingFeedback.reduce((sum, rating) => sum + rating, 0) / matchingFeedback.length
    : null;
  const feedbackAdjustment = averageFeedback === null ? 0 : averageFeedback >= 4 ? 5 : averageFeedback <= 2 ? -5 : 0;
  const adjustment = penalty + feedbackAdjustment;
  const parts: string[] = [];
  if (penalty) {
    parts.push(`${Math.abs(penalty) / 10} recent attendance signal(s) reduce suitability.`);
  }
  if (feedbackAdjustment > 0) {
    parts.push("Positive feedback on similar activities supports this format.");
  } else if (feedbackAdjustment < 0) {
    parts.push("Low feedback on similar activities reduces suitability.");
  }
  return { adjustment, text: parts.join(" ") || "No recent negative participation signal for this activity type." };
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

function toSkillLevel(level: number): SkillLevel {
  return Math.max(0, Math.min(5, Math.round(level))) as SkillLevel;
}
