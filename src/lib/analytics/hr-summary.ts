import type { ActivityStatus, EmployeeView } from "../../types/career";
import type { NormalizedDataset } from "../data/normalize";
import { getEmployeeView } from "../recommendation";

export interface HrSummary {
  weakCompetencies: Array<{ skillId: string; name: string; employeesBelowRequirement: number }>;
  employeesWithoutRecommendations: Array<{
    employeeId: string;
    fullName: string;
    reason: "needs_career_goal" | "no_eligible_step";
  }>;
  participationByEvent: Array<{
    eventId: string;
    title: string;
    total: number;
    byStatus: Partial<Record<ActivityStatus, number>>;
  }>;
}

export function buildHrSummary(dataset: NormalizedDataset): HrSummary {
  const views = dataset.employees.map((employee) => getEmployeeView(dataset, employee.employee_id));
  return {
    weakCompetencies: buildWeakCompetencies(views),
    employeesWithoutRecommendations: buildEmployeesWithoutRecommendations(views),
    participationByEvent: buildParticipationByEvent(dataset),
  };
}

function buildWeakCompetencies(views: EmployeeView[]): HrSummary["weakCompetencies"] {
  const totals = new Map<string, { name: string; employeesBelowRequirement: number }>();
  for (const view of views) {
    for (const gap of view.skillGaps) {
      if (gap.gap === 0) {
        continue;
      }
      const current = totals.get(gap.skillId) ?? { name: gap.name, employeesBelowRequirement: 0 };
      current.employeesBelowRequirement += 1;
      totals.set(gap.skillId, current);
    }
  }

  return [...totals.entries()]
    .map(([skillId, value]) => ({ skillId, ...value }))
    .sort(
      (left, right) =>
        right.employeesBelowRequirement - left.employeesBelowRequirement || left.name.localeCompare(right.name),
    );
}

function buildEmployeesWithoutRecommendations(
  views: EmployeeView[],
): HrSummary["employeesWithoutRecommendations"] {
  return views
    .filter((view) => view.recommendations.length === 0)
    .map((view) => ({
      employeeId: view.employee.employee_id,
      fullName: view.employee.full_name,
      reason: view.targetStatus === "needs_career_goal" ? "needs_career_goal" : "no_eligible_step",
    }));
}

function buildParticipationByEvent(dataset: NormalizedDataset): HrSummary["participationByEvent"] {
  const totals = new Map<string, { total: number; byStatus: Partial<Record<ActivityStatus, number>> }>();
  for (const record of dataset.history) {
    const current = totals.get(record.event_id) ?? { total: 0, byStatus: {} };
    current.total += 1;
    current.byStatus[record.status] = (current.byStatus[record.status] ?? 0) + 1;
    totals.set(record.event_id, current);
  }

  return [...totals.entries()]
    .map(([eventId, value]) => ({
      eventId,
      title: dataset.eventById.get(eventId)?.title ?? eventId,
      ...value,
    }))
    .sort((left, right) => right.total - left.total || left.title.localeCompare(right.title));
}
