import type { CareerDataset } from "../../src/types/career";

/** Synthetic server-side test fixture. Never imported by the application. */
export const demoDataset: CareerDataset = {
  skills: [
    { skill_id: "SK_SYS", name: "System design", type: "hard", category: "Engineering", description: "Design scalable systems" },
    { skill_id: "SK_CLOUD", name: "Cloud architecture", type: "hard", category: "Engineering", description: "Cloud platforms and architecture" },
    { skill_id: "SK_SQL", name: "SQL & data modeling", type: "hard", category: "Data", description: "Query and model data" },
    { skill_id: "SK_STORY", name: "Data storytelling", type: "soft", category: "Communication", description: "Communicate insights" },
    { skill_id: "SK_PRODUCT", name: "Product strategy", type: "hard", category: "Product", description: "Product strategy" },
  ],
  roleProfiles: [
    { role: "Backend Engineer", grade: "Middle", required_skills: { SK_SYS: 3, SK_CLOUD: 2 }, critical_skills: ["SK_SYS"] },
    { role: "Backend Engineer", grade: "Senior", required_skills: { SK_SYS: 4, SK_CLOUD: 3 }, critical_skills: ["SK_SYS", "SK_CLOUD"] },
    { role: "Data Analyst", grade: "Middle", required_skills: { SK_SQL: 3, SK_STORY: 2 }, critical_skills: ["SK_SQL"] },
    { role: "Data Analyst", grade: "Senior", required_skills: { SK_SQL: 4, SK_STORY: 3 }, critical_skills: ["SK_SQL", "SK_STORY"] },
    { role: "Product Manager", grade: "Middle", required_skills: { SK_PRODUCT: 3, SK_STORY: 2 }, critical_skills: ["SK_PRODUCT"] },
    { role: "Product Manager", grade: "Senior", required_skills: { SK_PRODUCT: 4, SK_STORY: 3 }, critical_skills: ["SK_PRODUCT", "SK_STORY"] },
  ],
  employees: [
    { employee_id: "EMP-014", full_name: "Amina Sadykova", department: "Digital Channels", role: "Backend Engineer", grade: "Middle", manager_id: null, hire_date: "2023-02-13", tenure_months: 43, work_format: "hybrid", preferred_language: "en", career_goal: null, skills: { SK_SYS: 3, SK_CLOUD: 2 }, last_review_date: "2026-01-01" },
    { employee_id: "EMP-027", full_name: "Dias Omarov", department: "Data & Analytics", role: "Data Analyst", grade: "Middle", manager_id: null, hire_date: "2024-05-20", tenure_months: 28, work_format: "hybrid", preferred_language: "en", career_goal: null, skills: { SK_SQL: 2 }, last_review_date: "2025-12-01" },
    { employee_id: "EMP-041", full_name: "Madina Bekova", department: "Customer Experience", role: "Product Manager", grade: "Middle", manager_id: null, hire_date: "2022-11-07", tenure_months: 47, work_format: "office", preferred_language: "en", career_goal: { target_role: "Product Manager", target_grade: "Senior" }, skills: { SK_PRODUCT: 3, SK_STORY: 2 }, last_review_date: "2026-02-01" },
  ],
  events: [
    { event_id: "EV_DEMO_01", title: "Designing high-load systems", description: "Practice architecture choices for resilient services.", type: "workshop", format: "self_paced", duration_hours: 4, mandatory: false, target_roles: ["Backend Engineer"], target_grades: ["Middle", "Senior"], develops_skills: [{ skill_id: "SK_SYS", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [] },
    { event_id: "EV_DEMO_02", title: "Cloud architecture foundations", description: "Build practical confidence with cloud design patterns.", type: "course", format: "self_paced", duration_hours: 3, mandatory: false, target_roles: ["Backend Engineer"], target_grades: ["Middle", "Senior"], develops_skills: [{ skill_id: "SK_CLOUD", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [] },
    { event_id: "EV_DEMO_03", title: "Analytics storytelling lab", description: "Turn analysis into clear decisions and narratives.", type: "workshop", format: "self_paced", duration_hours: 2, mandatory: false, target_roles: ["Data Analyst", "Product Manager"], target_grades: ["Middle", "Senior"], develops_skills: [{ skill_id: "SK_STORY", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [] },
    { event_id: "EV_DEMO_04", title: "SQL for analytical products", description: "Advance query and modeling practices for product analytics.", type: "course", format: "self_paced", duration_hours: 5, mandatory: false, target_roles: ["Data Analyst"], target_grades: ["Middle", "Senior"], develops_skills: [{ skill_id: "SK_SQL", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [] },
    { event_id: "EV_DEMO_05", title: "Product strategy intensive", description: "Connect customer needs, outcomes, and product bets.", type: "workshop", format: "self_paced", duration_hours: 4, mandatory: false, target_roles: ["Product Manager"], target_grades: ["Middle", "Senior"], develops_skills: [{ skill_id: "SK_PRODUCT", gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: [] },
  ],
  history: [
    { record_id: "H-001", employee_id: "EMP-014", event_id: "EV_DEMO_02", date: "2026-06-15", due_date: null, status: "completed", completion_pct: 100, score: 92, feedback_rating: 5, assigned_by: "self" },
    { record_id: "H-002", employee_id: "EMP-027", event_id: "EV_DEMO_03", date: "2026-03-11", due_date: null, status: "completed", completion_pct: 100, score: 87, feedback_rating: 4, assigned_by: "manager" },
  ],
};
