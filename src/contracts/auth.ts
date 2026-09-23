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
