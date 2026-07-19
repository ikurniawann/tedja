import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  LogbookCurrentUser,
  LogbookDepartment,
  LogbookTemplate,
  LogbookTemplatesParams,
  LogbookEntriesParams,
  LogbookEntriesResult,
  LogbookSummaryRow,
  CreateLogbookTemplatePayload,
  CreateLogbookEntryPayload,
  UpdateLogbookItemPayload,
  UpdateLogbookEntryStatusPayload,
} from "./types";

const BASE = "/api/hris/logbook";

async function mutateLogbook(
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
  url: string = BASE
) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Request failed");
  return json;
}

export const fetchLogbookMe = () =>
  apiGet<{ data: LogbookCurrentUser | null }>(`${BASE}?resource=me`).then(
    (res) => res.data
  );

export const fetchLogbookDepartments = () =>
  apiGet<{ data: LogbookDepartment[] }>(`${BASE}?resource=departments`).then(
    (res) => res.data
  );

export const fetchLogbookTemplates = (params?: LogbookTemplatesParams) =>
  apiGet<{ data: LogbookTemplate[] }>(
    buildListUrl(BASE, {
      resource: "templates",
      department_id: params?.department_id,
      include_inactive: params?.include_inactive ? "true" : undefined,
    })
  ).then((res) => res.data);

export const fetchLogbookEntries = (params?: LogbookEntriesParams) =>
  apiGet<LogbookEntriesResult>(
    buildListUrl(BASE, { resource: "entries", ...(params ?? {}) })
  );

export const fetchLogbookSummary = (params?: { department_id?: string }) =>
  apiGet<{ data: LogbookSummaryRow[] }>(
    buildListUrl(BASE, { resource: "summary", ...(params ?? {}) })
  ).then((res) => res.data);

export const createLogbookTemplate = (payload: CreateLogbookTemplatePayload) =>
  mutateLogbook("POST", { action: "create-template", ...payload });

export const createLogbookEntry = (payload: CreateLogbookEntryPayload) =>
  mutateLogbook("POST", { action: "create-entry", ...payload }) as Promise<{
    data?: { id?: string };
  }>;

export const updateLogbookItem = (payload: UpdateLogbookItemPayload) =>
  mutateLogbook("PATCH", { action: "update-item", ...payload });

export const updateLogbookEntryStatus = (payload: UpdateLogbookEntryStatusPayload) =>
  mutateLogbook("PATCH", payload as unknown as Record<string, unknown>);

export const deleteLogbookEntry = (entryId: string) =>
  mutateLogbook("DELETE", undefined, `${BASE}?resource=entry&id=${entryId}`);

export const deleteLogbookTemplate = (templateId: string) =>
  mutateLogbook(
    "DELETE",
    undefined,
    `${BASE}?resource=template&id=${templateId}`
  ) as Promise<{ message?: string; archived?: boolean }>;
