import {
  GRADES,
  REPEATABLE_EVENT_ID,
  SNAPSHOT_DATE,
  type ActivityRecord,
  type ActivityStatus,
  type AssignedBy,
  type CareerQuestDomainService,
  type CareerTarget,
  type DevelopmentEvent,
  type EmployeeDomainInput,
  type EmployeeProjection,
  type HrDomainInput,
  type HrSummary,
  type Recommendation,
  type RecommendationResult,
  type RoleProfile,
} from "@/contracts/types";

const RECENT_HISTORY_START = "2025-10-01";

function roleProfile(
  roleProfiles: RoleProfile[],
  role: string,
  grade: string,
): RoleProfile | null {
  return roleProfiles.find((profile) => profile.role === role && profile.grade === grade) ?? null;
}

function resolveTarget(input: EmployeeDomainInput): CareerTarget | null {
  const { employee, roleProfiles } = input;
  if (
    employee.career_goal &&
    roleProfile(roleProfiles, employee.career_goal.target_role, employee.career_goal.target_grade)
  ) {
    return {
      role: employee.career_goal.target_role,
      grade: employee.career_goal.target_grade,
      source: "career_goal",
    };
  }

  const currentIndex = GRADES.indexOf(employee.grade);
  if (currentIndex < 0 || currentIndex === GRADES.length - 1) return null;
  const nextGrade = GRADES[currentIndex + 1];
  if (!roleProfile(roleProfiles, employee.role, nextGrade)) return null;
  return { role: employee.role, grade: nextGrade, source: "next_grade" };
}

function effectiveSkills(input: EmployeeDomainInput): Record<string, number> {
  const levels = { ...input.employee.skills };
  const events = new Map(input.events.map((event) => [event.event_id, event]));
  const completions = input.activities
    .filter(
      (activity) =>
        activity.employee_id === input.employee.employee_id &&
        activity.status === "completed" &&
        activity.date > input.employee.last_review_date,
    )
    .sort((left, right) => left.date.localeCompare(right.date) || left.record_id.localeCompare(right.record_id));

  for (const activity of completions) {
    const event = events.get(activity.event_id);
    if (!event) continue;
    for (const effect of event.develops_skills) {
      const current = levels[effect.skill_id] ?? 0;
      levels[effect.skill_id] = Math.min(current + effect.gain, effect.max_level);
    }
  }
  return levels;
}

function eventAvailability(event: DevelopmentEvent) {
  if (event.format === "self_paced") {
    return { kind: "self_paced" as const, nextSession: null };
  }
  const nextSession = [...event.upcoming_sessions]
    .filter((date) => date >= SNAPSHOT_DATE)
    .sort()[0];
  return nextSession ? { kind: "scheduled" as const, nextSession } : null;
}

function overlappingSkills(left: DevelopmentEvent, right: DevelopmentEvent): boolean {
  const leftSkills = new Set(left.develops_skills.map((effect) => effect.skill_id));
  return right.develops_skills.some((effect) => leftSkills.has(effect.skill_id));
}

function historyAdjustment(
  candidate: DevelopmentEvent,
  activities: ActivityRecord[],
  events: Map<string, DevelopmentEvent>,
) {
  let positive = 0;
  let negative = 0;
  const signals: string[] = [];

  for (const activity of activities.filter((record) => record.date >= RECENT_HISTORY_START)) {
    const historicalEvent = events.get(activity.event_id);
    if (!historicalEvent) continue;
    const similar = historicalEvent.type === candidate.type || overlappingSkills(historicalEvent, candidate);
    if (!similar) continue;

    if (activity.status === "completed") {
      positive = Math.min(8, positive + 2);
      if (activity.feedback_rating && activity.feedback_rating >= 4) positive = Math.min(8, positive + 1);
    } else if (activity.status === "no_show") {
      negative = Math.max(-20, negative - 5);
    } else if (activity.status === "dropped") {
      negative = Math.max(-20, negative - 4);
    } else if (activity.status === "declined") {
      negative = Math.max(-20, negative - 3);
    }
  }

  if (positive > 0) signals.push(`Recent similar completions add ${positive} suitability points.`);
  if (negative < 0) signals.push(`Recent misses, drops, or declines subtract ${Math.abs(negative)} points.`);
  if (signals.length === 0) signals.push("No negative recent participation pattern was found for similar activities.");
  return { adjustment: positive + negative, signals };
}

export class DeterministicCareerQuestService implements CareerQuestDomainService {
  buildEmployeeProjection(input: EmployeeDomainInput): EmployeeProjection {
    const target = resolveTarget(input);
    const levels = effectiveSkills(input);
    const skillsById = new Map(input.skills.map((skill) => [skill.skill_id, skill]));
    const eventsById = new Map(input.events.map((event) => [event.event_id, event]));
    const employeeActivities = input.activities.filter(
      (activity) => activity.employee_id === input.employee.employee_id,
    );

    const completedActivities = employeeActivities
      .filter((activity) => activity.status === "completed")
      .map((activity) => {
        const event = eventsById.get(activity.event_id);
        return {
          ...activity,
          eventTitle: event?.title ?? activity.event_id,
          eventType: event?.type ?? "unknown",
          eventFormat: event?.format ?? "online",
        };
      });

    const activeMandatoryObligations = employeeActivities
      .filter((activity) => activity.status !== "completed" && eventsById.get(activity.event_id)?.mandatory)
      .map((activity) => {
        const event = eventsById.get(activity.event_id)!;
        return {
          ...activity,
          eventTitle: event.title,
          eventType: event.type,
          eventFormat: event.format,
          dueDate: activity.due_date,
        };
      });

    if (!target) {
      return {
        employee: input.employee,
        target: null,
        targetStatus: "no_target",
        effectiveSkills: levels,
        readiness: null,
        skillGaps: [],
        completedActivities,
        activeMandatoryObligations,
      };
    }

    const profile = roleProfile(input.roleProfiles, target.role, target.grade)!;
    const critical = new Set(profile.critical_skills);
    const skillGaps = Object.entries(profile.required_skills)
      .map(([skillId, requiredLevel]) => {
        const currentLevel = levels[skillId] ?? 0;
        return {
          skillId,
          name: skillsById.get(skillId)?.name ?? skillId,
          currentLevel,
          requiredLevel,
          gap: Math.max(0, requiredLevel - currentLevel),
          critical: critical.has(skillId),
        };
      })
      .filter((gap) => gap.gap > 0)
      .sort((left, right) =>
        Number(right.critical) - Number(left.critical) || right.gap - left.gap || left.name.localeCompare(right.name),
      );

    let achieved = 0;
    let required = 0;
    for (const [skillId, requiredLevel] of Object.entries(profile.required_skills)) {
      if (requiredLevel <= 0) continue;
      const weight = critical.has(skillId) ? 2 : 1;
      required += requiredLevel * weight;
      achieved += Math.min(levels[skillId] ?? 0, requiredLevel) * weight;
    }
    const readiness = required === 0 ? 100 : Math.round((achieved / required) * 1000) / 10;

    return {
      employee: input.employee,
      target,
      targetStatus: "ready",
      effectiveSkills: levels,
      readiness,
      skillGaps,
      completedActivities,
      activeMandatoryObligations,
    };
  }

  recommend(input: EmployeeDomainInput): RecommendationResult {
    const projection = this.buildEmployeeProjection(input);
    if (!projection.target) {
      return {
        employeeId: input.employee.employee_id,
        target: null,
        recommendations: [],
        emptyReason: "no_target",
        source: "deterministic",
      };
    }

    const gaps = new Map(projection.skillGaps.map((gap) => [gap.skillId, gap]));
    const employeeActivities = input.activities.filter(
      (activity) => activity.employee_id === input.employee.employee_id,
    );
    const completed = new Set(
      employeeActivities.filter((activity) => activity.status === "completed").map((activity) => activity.event_id),
    );
    const inProgress = new Set(
      employeeActivities.filter((activity) => activity.status === "in_progress").map((activity) => activity.event_id),
    );
    const eventsById = new Map(input.events.map((event) => [event.event_id, event]));
    const candidates: Recommendation[] = [];

    for (const event of input.events) {
      if (event.mandatory) continue;
      if (!event.target_roles.includes(input.employee.role) && !event.target_roles.includes(projection.target.role)) continue;
      if (!event.target_grades.includes(input.employee.grade)) continue;
      if (event.event_id !== REPEATABLE_EVENT_ID && completed.has(event.event_id)) continue;
      if (inProgress.has(event.event_id)) continue;
      if (
        Object.entries(event.prerequisites).some(
          ([skillId, minimum]) => (projection.effectiveSkills[skillId] ?? 0) < minimum,
        )
      ) {
        continue;
      }
      const availability = eventAvailability(event);
      if (!availability) continue;

      const skillImpacts = event.develops_skills.flatMap((effect) => {
        const gap = gaps.get(effect.skill_id);
        if (!gap) return [];
        const before = projection.effectiveSkills[effect.skill_id] ?? 0;
        const after = Math.min(before + effect.gain, effect.max_level);
        const gapReduction = Math.min(gap.gap, Math.max(0, after - before));
        if (gapReduction <= 0) return [];
        return [
          {
            skillId: effect.skill_id,
            skillName: gap.name,
            before,
            after,
            required: gap.requiredLevel,
            gapReduction,
            critical: gap.critical,
          },
        ];
      });
      if (skillImpacts.length === 0) continue;

      const criticalReduction = skillImpacts
        .filter((impact) => impact.critical)
        .reduce((total, impact) => total + impact.gapReduction, 0);
      const regularReduction = skillImpacts
        .filter((impact) => !impact.critical)
        .reduce((total, impact) => total + impact.gapReduction, 0);
      const history = historyAdjustment(event, employeeActivities, eventsById);
      const score =
        criticalReduction * 40 +
        regularReduction * 15 +
        skillImpacts.length * 5 +
        history.adjustment;
      const mainImpact = [...skillImpacts].sort(
        (left, right) => Number(right.critical) - Number(left.critical) || right.gapReduction - left.gapReduction,
      )[0];
      const factors = [
        `${projection.target.role} ${projection.target.grade} requires ${mainImpact.skillName} level ${mainImpact.required}; current effective level is ${mainImpact.before}.`,
        `${event.title} raises ${mainImpact.skillName} to ${mainImpact.after} and reduces the target gap by ${mainImpact.gapReduction}.`,
        history.signals[0],
        availability.kind === "self_paced"
          ? "The activity is self-paced and available now."
          : `The next available session is ${availability.nextSession}.`,
      ];

      candidates.push({
        event,
        score,
        evidence: {
          target: projection.target,
          factors,
          historySignals: history.signals,
          skillImpacts,
        },
        availability,
        explanation: factors.join(" "),
      });
    }

    const recommendations = candidates
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const leftDate = left.availability.nextSession ?? "0000-00-00";
        const rightDate = right.availability.nextSession ?? "0000-00-00";
        return leftDate.localeCompare(rightDate) || left.event.event_id.localeCompare(right.event.event_id);
      })
      .slice(0, 3);

    return {
      employeeId: input.employee.employee_id,
      target: projection.target,
      recommendations,
      emptyReason: recommendations.length ? null : "no_eligible_events",
      source: "deterministic",
    };
  }

  buildHrSummary(input: HrDomainInput): HrSummary {
    const employees = input.dataset.employees.filter((employee) => {
      if (input.filters.role && employee.role !== input.filters.role) return false;
      if (input.filters.grade && employee.grade !== input.filters.grade) return false;
      if (input.filters.department && employee.department !== input.filters.department) return false;
      return true;
    });
    const employeeIds = new Set(employees.map((employee) => employee.employee_id));
    const gapStats = new Map<
      string,
      { skillId: string; skillName: string; employeesAffected: number; totalSeverity: number; criticalOccurrences: number }
    >();
    const employeesWithoutTarget: HrSummary["employeesWithoutTarget"] = [];
    const employeesWithoutRecommendations: HrSummary["employeesWithoutRecommendations"] = [];

    for (const employee of employees) {
      const employeeInput: EmployeeDomainInput = {
        employee,
        skills: input.dataset.skills,
        roleProfiles: input.dataset.roleProfiles,
        events: input.dataset.events,
        activities: input.dataset.activities,
      };
      const projection = this.buildEmployeeProjection(employeeInput);
      if (!projection.target) {
        employeesWithoutTarget.push({
          employeeId: employee.employee_id,
          fullName: employee.full_name,
          role: employee.role,
          grade: employee.grade,
        });
      }
      for (const gap of projection.skillGaps) {
        const stat = gapStats.get(gap.skillId) ?? {
          skillId: gap.skillId,
          skillName: gap.name,
          employeesAffected: 0,
          totalSeverity: 0,
          criticalOccurrences: 0,
        };
        stat.employeesAffected += 1;
        stat.totalSeverity += gap.gap;
        if (gap.critical) stat.criticalOccurrences += 1;
        gapStats.set(gap.skillId, stat);
      }
      if (this.recommend(employeeInput).recommendations.length === 0) {
        employeesWithoutRecommendations.push({
          employeeId: employee.employee_id,
          fullName: employee.full_name,
          role: employee.role,
          grade: employee.grade,
        });
      }
    }

    const activities = input.dataset.activities.filter((activity) => employeeIds.has(activity.employee_id));
    const participationByStatus: Record<ActivityStatus, number> = {
      completed: 0,
      in_progress: 0,
      dropped: 0,
      no_show: 0,
      declined: 0,
      overdue: 0,
    };
    const assignedBy: Record<AssignedBy, number> = { self: 0, manager: 0, hr: 0 };
    const perEvent = new Map<string, { participants: number; completed: number }>();
    for (const activity of activities) {
      participationByStatus[activity.status] += 1;
      assignedBy[activity.assigned_by] += 1;
      const stat = perEvent.get(activity.event_id) ?? { participants: 0, completed: 0 };
      stat.participants += 1;
      if (activity.status === "completed") stat.completed += 1;
      perEvent.set(activity.event_id, stat);
    }
    const eventsById = new Map(input.dataset.events.map((event) => [event.event_id, event]));
    const completed = participationByStatus.completed;
    const completionRate = activities.length ? Math.round((completed / activities.length) * 1000) / 10 : 0;

    return {
      population: employees.length,
      filters: input.filters,
      commonSkillGaps: [...gapStats.values()].sort(
        (left, right) =>
          right.employeesAffected - left.employeesAffected ||
          right.totalSeverity - left.totalSeverity ||
          left.skillName.localeCompare(right.skillName),
      ),
      employeesWithoutTarget,
      employeesWithoutRecommendations,
      participationByStatus,
      assignedBy,
      completionRate,
      activityParticipation: [...perEvent.entries()]
        .map(([eventId, stat]) => ({
          eventId,
          title: eventsById.get(eventId)?.title ?? eventId,
          participants: stat.participants,
          completed: stat.completed,
          completionRate: stat.participants
            ? Math.round((stat.completed / stat.participants) * 1000) / 10
            : 0,
        }))
        .sort((left, right) => right.participants - left.participants || left.eventId.localeCompare(right.eventId)),
    };
  }
}
