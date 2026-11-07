import type { components } from "./api-types";

type Schemas = components["schemas"];

export type ForecastResponse = Schemas["ForecastResponse"];
export type AnalyzeRequest = Schemas["AnalyzeRequest"];
export type AnalyzeResponse = Schemas["AnalyzeResponse"];
export type AlternativeRequest = Schemas["AlternativeRequest"];
export type AlternativeResponse = Schemas["AlternativeResponse"];
export type BriefingRequest = Schemas["BriefingRequest"];
export type BriefingResponse = Schemas["BriefingResponse"];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

export const api = {
  forecast: (date?: string) =>
    request<ForecastResponse>(date ? `/forecast?date=${date}` : "/forecast"),
  analyze: (body: AnalyzeRequest) => request<AnalyzeResponse>("/analyze", body),
  alternative: (body: AlternativeRequest) =>
    request<AlternativeResponse>("/alternative", body),
  briefing: (body: BriefingRequest) => request<BriefingResponse>("/briefing", body),
};
