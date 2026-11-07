import type { components } from "./api-types";

type Schemas = components["schemas"];

export type ForecastResponse = Schemas["ForecastResponse"];
export type AnalyzeRequest = Schemas["AnalyzeRequest"];
export type AnalyzeResponse = Schemas["AnalyzeResponse"];
export type AlternativeRequest = Schemas["AlternativeRequest"];
export type AlternativeResponse = Schemas["AlternativeResponse"];
export type BriefingRequest = Schemas["BriefingRequest"];
export type BriefingResponse = Schemas["BriefingResponse"];
export type PlanRequest = Schemas["PlanRequest"];
export type PlanResponse = Schemas["PlanResponse"];
export type SuggestionsRequest = Schemas["SuggestionsRequest"];
export type SuggestionsResponse = Schemas["SuggestionsResponse"];
export type EndpointSuggestionsRequest = Schemas["EndpointSuggestionsRequest"];
export type EndpointSuggestionsResponse = Schemas["EndpointSuggestionsResponse"];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    signal,
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : `${path} returned ${response.status}`);
  }
  return response.json();
}

export const api = {
  forecast: (date?: string) =>
    request<ForecastResponse>(date ? `/forecast?date=${date}` : "/forecast"),
  analyze: (body: AnalyzeRequest) => request<AnalyzeResponse>("/analyze", body),
  alternative: (body: AlternativeRequest) =>
    request<AlternativeResponse>("/alternative", body),
  suggestions: (body: SuggestionsRequest) =>
    request<SuggestionsResponse>("/suggestions", body),
  endpointSuggestions: (body: EndpointSuggestionsRequest) =>
    request<EndpointSuggestionsResponse>("/endpoint-suggestions", body),
  briefing: (body: BriefingRequest) => request<BriefingResponse>("/briefing", body),
  plan: (body: PlanRequest, signal?: AbortSignal) =>
    request<PlanResponse>("/plan", body, signal),
};
