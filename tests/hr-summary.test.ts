import { describe, expect, it } from "vitest";
import { buildHrSummary } from "../src/lib/analytics/hr-summary";
import { normalizeDataset } from "../src/lib/data/normalize";
import type { CareerDataset, DevelopmentEvent, Employee, RoleProfile, Skill } from "../src/types/career";

const skills: Skill[] = [
  { skill_id: "SK_CORE", name: "Core Skill", type: "hard", category: "Core", description: "" },
];
const employee: Employee = {
  employee_id: "E_LEAD",
  full_name: "Lead Example",
  department: "Engineering",
  role: "Backend Engineer",
  grade: "Lead",
  manager_id: null,
  hire_date: "2020-01-01",
  tenure_months: 80,
  work_format: "office",
  preferred_language: "en",
  career_goal: null,
  skills: {},
  last_review_date: "2026-01-01",
};
const engineer: Employee = {
  ...employee,
  employee_id: "E_MIDDLE",
  full_name: "Middle Example",
  grade: "Middle",
};
const events: DevelopmentEvent[] = [
  {
    event_id: "EV_001",
    title: "Core Workshop",
    description: "",
    type: "workshop",
    format: "self_paced",
    duration_hours: 1,
    mandatory: false,
    target_roles: ["Backend Engineer"],
    target_grades: ["Lead"],
    develops_skills: [{ skill_id: "SK_CORE", gain: 1, max_level: 5 }],
    prerequisites: {},
    upcoming_sessions: [],
  },
];
const roleProfiles: RoleProfile[] = [
  { role: "Backend Engineer", grade: "Lead", required_skills: { SK_CORE: 3 }, critical_skills: ["SK_CORE"] },
  { role: "Backend Engineer", grade: "Senior", required_skills: { SK_CORE: 3 }, critical_skills: ["SK_CORE"] },
];
const dataset: CareerDataset = {
  employees: [employee, engineer],
  events,
  skills,
  roleProfiles,
  history: [],
};

describe("HR summary", () => {
  it("counts target skill gaps and identifies employees without a next step", () => {
    const summary = buildHrSummary(normalizeDataset(dataset));
    expect(summary.weakCompetencies).toEqual([
      { skillId: "SK_CORE", name: "Core Skill", employeesBelowRequirement: 1 },
    ]);
    expect(summary.employeesWithoutRecommendations).toEqual([
      { employeeId: "E_LEAD", fullName: "Lead Example", reason: "needs_career_goal" },
      { employeeId: "E_MIDDLE", fullName: "Middle Example", reason: "no_eligible_step" },
    ]);
    expect(summary.participationByEvent).toEqual([]);
  });
});
