import type { DevelopmentEvent, Employee, Grade, SkillLevel } from "../../types/career";

export const SNAPSHOT_DATE = "2026-10-01";

export function matchesAudience(
  event: DevelopmentEvent,
  employee: Employee,
  target: { role: string; grade: Grade } | null,
): boolean {
  const includes = (role: string, grade: Grade) =>
    event.target_roles.includes(role) && event.target_grades.includes(grade);
  return includes(employee.role, employee.grade) || (target !== null && includes(target.role, target.grade));
}

export function getUnmetPrerequisites(event: DevelopmentEvent, skills: Record<string, SkillLevel>) {
  return Object.entries(event.prerequisites)
    .filter(([skillId, required]) => (skills[skillId] ?? 0) < (required ?? 0))
    .map(([skillId, required]) => ({ skillId, current: skills[skillId] ?? 0, required: required ?? 0 }));
}

export function getNextSession(event: DevelopmentEvent): string | undefined {
  return event.upcoming_sessions.filter((session) => session >= SNAPSHOT_DATE).sort()[0];
}
