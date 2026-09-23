import type {
  ActivityRecord,
  CareerDataset,
  DevelopmentEvent,
  Employee,
  RoleProfile,
  Skill,
} from "../../types/career";

export interface NormalizedDataset extends CareerDataset {
  employeeById: Map<string, Employee>;
  eventById: Map<string, DevelopmentEvent>;
  skillById: Map<string, Skill>;
  roleProfileByKey: Map<string, RoleProfile>;
  historyByEmployeeId: Map<string, ActivityRecord[]>;
}

export function roleProfileKey(role: string, grade: string): string {
  return `${role}::${grade}`;
}

function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex)!;
    const rightPoint = right.codePointAt(rightIndex)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}

export function normalizeDataset(dataset: CareerDataset): NormalizedDataset {
  const employeeById = new Map(dataset.employees.map((employee) => [employee.employee_id, employee]));
  const eventById = new Map(dataset.events.map((event) => [event.event_id, event]));
  const skillById = new Map(dataset.skills.map((skill) => [skill.skill_id, skill]));
  const roleProfileByKey = new Map(
    dataset.roleProfiles.map((profile) => [roleProfileKey(profile.role, profile.grade), profile]),
  );
  const historyByEmployeeId = new Map<string, ActivityRecord[]>();

  for (const record of dataset.history) {
    const records = historyByEmployeeId.get(record.employee_id) ?? [];
    records.push(record);
    historyByEmployeeId.set(record.employee_id, records);
  }

  for (const records of historyByEmployeeId.values()) {
    // Dates have no time component: use one deterministic event/record tie order for
    // imports, previews and SQLite replay. Code-point order matches SQLite BINARY;
    // localeCompare and UTF-16 ordering can disagree for case or supplementary text.
    records.sort((left, right) => compareCodePoints(left.date, right.date) ||
      compareCodePoints(left.event_id, right.event_id) || compareCodePoints(left.record_id, right.record_id));
  }

  return {
    ...dataset,
    employeeById,
    eventById,
    skillById,
    roleProfileByKey,
    historyByEmployeeId,
  };
}
