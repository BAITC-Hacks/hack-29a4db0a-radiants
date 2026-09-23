import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { DemoLoginSelection } from "@/contracts/auth";
import { AppError } from "@/server/errors";

export const isDemoEmployeeLoginEnabled = () => process.env.DEMO_EMPLOYEE_LOGIN === "true";
export const isDemoUserId = (id: string) => id.startsWith("demo:");
export const normalizeEmployeeName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

interface EmployeeIdentity { employee_id: string; full_name: string; department: string; role: string; grade: string }
interface DemoUserRow { user_id: string; username: string; role: "employee"; employee_id: string; password_hash: string; active: number; employee_name?: string }

/** Only called after the explicit demo flag and shared password have been checked. */
export function resolveDemoEmployeeLogin(name: string, db: Database.Database, employeeId?: string): DemoUserRow | DemoLoginSelection | undefined {
  const employees = db.prepare("SELECT employee_id, full_name, department, role, grade FROM employees ORDER BY department, role, grade, employee_id").all() as EmployeeIdentity[];
  const normalized = normalizeEmployeeName(name);
  const matches = employees.filter((employee) => normalizeEmployeeName(employee.full_name) === normalized);
  if (matches.length > 1 && employeeId === undefined) {
    return { kind: "employee_selection", choices: matches.map((employee) => ({
      employeeId: employee.employee_id, fullName: employee.full_name, department: employee.department,
      role: employee.role, grade: employee.grade,
    })) };
  }
  // A selected card is accepted only while its ID still belongs to this exact name.
  const employee = employeeId === undefined ? matches[0] : matches.find((match) => match.employee_id === employeeId);
  if (!employee) return;
  const identity = createHash("sha256").update(employee.employee_id).digest("hex");
  return db.transaction(() => {
    const userId = `demo:${identity}`;
    const existing = db.prepare("SELECT * FROM auth_users WHERE user_id=?").get(userId) as DemoUserRow | undefined;
    if (existing) {
      if (existing.role !== "employee" || existing.employee_id !== employee.employee_id) return;
      return { ...existing, employee_name: employee.full_name };
    }
    // No reusable password is stored: this identity can only use the gated demo path.
    const row: DemoUserRow = { user_id: userId, username: `demo.${identity}`, role: "employee",
      employee_id: employee.employee_id, password_hash: "!demo-login-only", active: 1 };
    // Preserve any operator-created account with a coincidentally matching username.
    if (db.prepare("SELECT 1 FROM auth_users WHERE username=? COLLATE NOCASE").get(row.username)) {
      throw new AppError(409, "DEMO_ACCOUNT_CONFLICT", "An account conflicts with this demo identity. Ask the application operator.");
    }
    db.prepare("INSERT INTO auth_users(user_id,username,password_hash,role,employee_id,active,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(row.user_id, row.username, row.password_hash, row.role, row.employee_id, row.active, Date.now());
    return { ...row, employee_name: employee.full_name };
  }).immediate();
}

/** Called with the flag disabled so re-enabling cannot resurrect old demo sessions. */
export function revokeDemoSessions(db: Database.Database): void {
  db.prepare("DELETE FROM auth_sessions WHERE user_id LIKE 'demo:%'").run();
}
