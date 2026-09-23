import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HRFilters } from "../src/components/HRFilters";

const employees = [
  { employee_id: "ONE", full_name: "One", role: "Engineer", department: "Engineering", grade: "Junior" as const },
  { employee_id: "TWO", full_name: "Two", role: "Engineer", department: "Operations", grade: "Lead" as const },
];
const render = (filters = {}) => renderToStaticMarkup(createElement(HRFilters, { filters, employees, roleProfiles: [], onChange() {} }));

describe("HR filter controls", () => {
  it("offers all dimensions and an explicit reset without exposing employee names", () => {
    const html = render();
    for (const label of ["Все роли", "Все грейды", "Все подразделения", "Сбросить фильтры", "Engineering", "Operations", "Junior", "Lead"]) expect(html).toContain(label);
    expect(html).not.toContain("ONE");
    expect(html.match(/value="Engineer"/g)).toHaveLength(1);
    expect(html).toContain("disabled");
  });
  it("keeps selected filters and enables reset even when results will be empty", () => {
    const html = render({ role: "Engineer", department: "Operations", grade: "Junior" });
    expect(html.match(/selected=""/g)).toHaveLength(3);
    expect(html).not.toContain("disabled");
  });
});
