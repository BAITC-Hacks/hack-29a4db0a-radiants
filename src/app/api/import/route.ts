import { apiError, apiSuccess } from "@/server/http";
import { importData } from "@/server/services/import";
import { AppError } from "@/server/errors";

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
    let formData: FormData;
    try {
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
        throw new Error("Expected multipart form data");
      }
      formData = await request.formData();
    } catch {
      throw new AppError(400, "INVALID_MULTIPART", "Expected a valid multipart/form-data request");
    }
    const employees = await fileContent(formData.get("employees"));
    const history = await fileContent(formData.get("history"));
    return apiSuccess(
      importData({
        employeesJson: employees?.text,
        employeeFileName: employees?.name,
        historyCsv: history?.text,
        historyFileName: history?.name,
      }),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
