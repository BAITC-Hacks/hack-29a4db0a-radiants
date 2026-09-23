import { apiError, apiSuccess, readLimitedBody } from "@/server/http";
import { importData } from "@/server/services/import";
import { AppError } from "@/server/errors";
import { parseActivityCsv, parseEmployeeImport } from "@/server/data/parsers";
import { authenticate, assertMutation, requireHr, audit } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fileContent(value: FormDataEntryValue | null) {
  if (!value) return undefined;
  if (typeof value === "string") return { text: value, name: undefined };
  if (value.size === 0) return undefined;
  return { text: await value.text(), name: value.name };
}

export async function POST(request: Request) {
  try {
    const session = authenticate(request);
    requireHr(session);
    assertMutation(request, session);
    let formData: FormData;
    try {
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
        throw new Error("Expected multipart form data");
      }
      const body = await readLimitedBody(request, 10 * 1024 * 1024);
      formData = await new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "INVALID_MULTIPART", "Expected a valid multipart/form-data request");
    }
    const employees = await fileContent(formData.get("employees"));
    const history = await fileContent(formData.get("history"));
    const result = importData({
        employeesJson: employees?.text,
        employeeFileName: employees?.name,
        historyCsv: history?.text,
        historyFileName: history?.name,
      });
    const employeeIds = [...new Set([
      ...(employees ? parseEmployeeImport(employees.text, employees.name).map((employee) => employee.employee_id) : []),
      ...(history ? parseActivityCsv(history.text, history.name).map((activity) => activity.employee_id) : []),
    ])];
    audit(session.user.id, "data.imported");
    return apiSuccess({ ...result, employeeIds }, 201);
  } catch (error) {
    return apiError(error);
  }
}
