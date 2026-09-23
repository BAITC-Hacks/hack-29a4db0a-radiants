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
    records.sort((left, right) => left.date.localeCompare(right.date));
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
