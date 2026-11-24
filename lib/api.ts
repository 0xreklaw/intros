/** Thin fetch client for mutations from the browser. Reads happen in server components. */
import type {
  ClientDetail,
  EmployeeSocials,
  EnrichSummary,
  ImportResult,
  ProspectProfile,
  SearchResponse,
  SearchSettings,
  SocialImportResult,
  SocialSettings,
} from "@/src/clients/types"
import type { CountrySettings } from "@/src/clients/countries"

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
  } & Record<string, unknown>
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  createClient: (body: { name: string; domain: string }) =>
    request<{ client: { id: string } }>("POST", "/clients", body).then(
      (r) => r.client
    ),
  createEmployee: (clientId: string, body: { name: string }) =>
    request<{ employee: { id: string } }>(
      "POST",
      `/clients/${clientId}/employees`,
      body
    ),
  clientDetail: (clientId: string) =>
    request<ClientDetail>("GET", `/clients/${clientId}`),
  importEmployees: (clientId: string) =>
    request<{ result: ImportResult }>(
      "POST",
      `/clients/${clientId}/import-employees`
    ).then((r) => r.result),
  setEmployeeSocials: (
    clientId: string,
    employeeId: string,
    body: { x: string; instagram: string; linkedin: string }
  ) =>
    request<{ socials: EmployeeSocials }>(
      "PUT",
      `/clients/${clientId}/employees/${employeeId}/socials`,
      body
    ).then((r) => r.socials),
  importNetwork: (clientId: string, employeeId: string) =>
    request<{ result: SocialImportResult }>(
      "POST",
      `/clients/${clientId}/employees/${employeeId}/import-network`
    ).then((r) => r.result),
  saveSocialSettings: (settings: SocialSettings) =>
    request<{ settings: SocialSettings }>(
      "PUT",
      "/settings/social",
      settings
    ).then((r) => r.settings),
  /** `read` rates people who are not rated yet; `review` also runs the agent on the top matches. */
  search: (
    clientId: string,
    query: string | null,
    step: "read" | "review" = "read"
  ) =>
    request<SearchResponse>("POST", `/clients/${clientId}/search`, {
      query,
      score: true,
      review: step === "review",
    }),
  enrich: (clientId: string, personIds: string[], dryRun: boolean) =>
    request<{ summary: EnrichSummary }>("POST", `/clients/${clientId}/enrich`, {
      personIds,
      dryRun,
    }).then((r) => r.summary),
  prospect: (clientId: string, personId: string) =>
    request<{ profile: ProspectProfile }>(
      "GET",
      `/clients/${clientId}/people/${personId}`
    ).then((r) => r.profile),
  saveCountrySettings: (settings: CountrySettings) =>
    request<{ settings: CountrySettings }>(
      "PUT",
      "/settings/countries",
      settings
    ).then((r) => r.settings),
  saveSearchSettings: (settings: SearchSettings) =>
    request<{ settings: SearchSettings }>(
      "PUT",
      "/settings/search",
      settings
    ).then((r) => r.settings),
}
