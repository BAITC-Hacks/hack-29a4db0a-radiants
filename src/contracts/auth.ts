export type UserRole = "employee" | "hr";

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  employeeId: string | null;
}

export interface AuthSession {
  user: SessionUser;
  expiresAt: string;
  csrfToken: string;
}

export interface DemoLoginChoice {
  employeeId: string;
  fullName: string;
  department: string;
  role: string;
  grade: string;
}

export interface DemoLoginSelection {
  kind: "employee_selection";
  choices: DemoLoginChoice[];
}

export type AuthLoginResult = AuthSession | DemoLoginSelection;
