import { z } from "zod";

const dateSchema = z.iso.date();
const levelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const gradeSchema = z.enum(["Junior", "Middle", "Senior", "Lead"]);

export const skillSchema = z.object({
  skill_id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["hard", "soft"]),
  category: z.string().min(1),
  description: z.string(),
});

export const roleProfileSchema = z.object({
  role: z.string().min(1),
  grade: gradeSchema,
  required_skills: z.record(z.string(), levelSchema),
  critical_skills: z.array(z.string()),
});

export const employeeSchema = z.object({
  employee_id: z.string().min(1),
  full_name: z.string().min(1),
  department: z.string().min(1),
  role: z.string().min(1),
  grade: gradeSchema,
  manager_id: z.string().nullable(),
  hire_date: dateSchema,
  tenure_months: z.number().int().nonnegative(),
  work_format: z.enum(["office", "hybrid", "remote"]),
  preferred_language: z.enum(["kk", "ru", "en"]),
  career_goal: z
    .object({
      target_role: z.string().min(1),
      target_grade: gradeSchema,
    })
    .nullable(),
  skills: z.record(z.string(), levelSchema),
  last_review_date: dateSchema,
});

export const eventSchema = z.object({
  event_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(["compliance", "onboarding", "course", "workshop", "mentoring", "certification", "meetup"]),
  format: z.enum(["online", "offline", "self_paced"]),
  duration_hours: z.number().nonnegative(),
  mandatory: z.boolean(),
  target_roles: z.array(z.string()),
  target_grades: z.array(gradeSchema),
  develops_skills: z.array(
    z.object({
      skill_id: z.string().min(1),
      gain: z.number().int().min(0).max(5),
      max_level: levelSchema,
    }),
  ),
  prerequisites: z.record(z.string(), levelSchema),
  upcoming_sessions: z.array(dateSchema),
});

export const activitySchema = z.object({
  record_id: z.string().min(1),
  employee_id: z.string().min(1),
  event_id: z.string().min(1),
  date: dateSchema,
  due_date: dateSchema.nullable(),
  status: z.enum(["completed", "in_progress", "dropped", "no_show", "declined", "overdue"]),
  completion_pct: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100).nullable(),
  feedback_rating: z.number().int().min(1).max(5).nullable(),
  assigned_by: z.enum(["self", "manager", "hr"]),
});

export const skillsFileSchema = z.object({
  meta: z.record(z.string(), z.unknown()).optional(),
  proficiency_scale: z.unknown().optional(),
  skills: z.array(skillSchema),
  role_profiles: z.array(roleProfileSchema),
});

export const employeesFileSchema = z.object({
  meta: z.record(z.string(), z.unknown()).optional(),
  employees: z.array(employeeSchema),
});

export const eventsFileSchema = z.object({
  meta: z.record(z.string(), z.unknown()).optional(),
  events: z.array(eventSchema),
});

export const employeeImportSchema = z.union([
  employeesFileSchema,
  employeeSchema,
  z.array(employeeSchema),
]);

export const completeActivitySchema = z.object({
  completedAt: dateSchema.optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
  feedbackRating: z.number().int().min(1).max(5).nullable().optional(),
});

export const employeeListQuerySchema = z.object({
  search: z.string().trim().optional(),
  role: z.string().trim().optional(),
  grade: gradeSchema.optional(),
  department: z.string().trim().optional(),
});

export const hrQuerySchema = z.object({
  role: z.string().trim().optional(),
  grade: gradeSchema.optional(),
  department: z.string().trim().optional(),
});
