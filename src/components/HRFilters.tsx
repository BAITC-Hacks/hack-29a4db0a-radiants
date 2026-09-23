import type { CatalogResult, HrFilters } from "../contracts/api";
import type { EmployeeListItem } from "../lib/frontend/api";

export function HRFilters({ filters, employees, roleProfiles, onChange }: {
  filters: HrFilters;
  employees: EmployeeListItem[];
  roleProfiles: CatalogResult["roleProfiles"];
  onChange: (filters: HrFilters) => void;
}) {
  const roles = [...new Set([...roleProfiles.map((profile) => profile.role), ...employees.map((employee) => employee.role)])].sort();
  const departments = [...new Set(employees.map((employee) => employee.department).filter((value): value is string => !!value))].sort();
  const grades = (["Junior", "Middle", "Senior", "Lead"] as const).filter((grade) =>
    roleProfiles.some((profile) => profile.grade === grade) || employees.some((employee) => employee.grade === grade));
  const update = (key: keyof HrFilters, value: string) => {
    const next = { ...filters, [key]: value || undefined };
    onChange(next);
  };
  return <section className="hr-filters surface" aria-label="Фильтры обзора команды">
    <label htmlFor="hr-role">Роль<select id="hr-role" value={filters.role ?? ""} onChange={(event) => update("role", event.target.value)}>
      <option value="">Все роли</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}
    </select></label>
    <label htmlFor="hr-grade">Грейд<select id="hr-grade" value={filters.grade ?? ""} onChange={(event) => update("grade", event.target.value)}>
      <option value="">Все грейды</option>{grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
    </select></label>
    <label htmlFor="hr-department">Подразделение<select id="hr-department" value={filters.department ?? ""} onChange={(event) => update("department", event.target.value)}>
      <option value="">Все подразделения</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}
    </select></label>
    <button className="button button-outline" disabled={!filters.role && !filters.grade && !filters.department} onClick={() => onChange({})}>Сбросить фильтры</button>
  </section>;
}
