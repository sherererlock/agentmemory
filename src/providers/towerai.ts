import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MemoryProvider } from "../types.js";
import { getEnvVar } from "../config.js";
import { fetchWithTimeout } from "./_fetch.js";

/**
 * TowerAI LLM provider — OpenAI-compatible gateway with custom SSE format.
 *
 * TowerAI returns SSE (event-stream) for both streaming and non-streaming requests.
 * This provider parses the SSE text events to extract the generated content.
 *
 * Endpoint routing (mirrors deer-flow towerai_provider.py):
 *   gpt-*, o1*, o3* → /zi/webapi/chat/zetta_ai only
 *   claude-*, gemini-* → /zi/webapi/chat/zetta_ai then /zi/webapi/chat/vertexai fallback
 *
 * Credential resolution (highest → lowest priority):
 *   1. TOWERAI_TOKEN env var
 *   2. ~/.towerai/state.json  (written by `towerai connect` / browser auth)
 *
 * Optional env vars:
 *   TOWERAI_AUTH_TOKEN       — override auth token from state.json
 *   TOWERAI_BASE_URL         — override base URL from state.json
 *   TOWERAI_MODEL            — model name (default: gpt-4o-mini)
 *   AGENTMEMORY_LLM_TIMEOUT_MS — request timeout in ms (default: 60000)
 */

const DEFAULT_BASE_URL = "https://tower-ai.yottastudios.com";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;

const EP_ZETTA = "/zi/webapi/chat/zetta_ai";
const EP_VERTEXAI = "/zi/webapi/chat/vertexai";

function resolveEndpoints(model: string): string[] {
  const m = model.toLowerCase();
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3")) {
    return [EP_ZETTA];
  }
  return [EP_ZETTA, EP_VERTEXAI];
}

function isTokenError(text: string): boolean {
  const s = text.trim();
  if (!s.startsWith("{") || !s.includes("error_code")) return false;
  const lower = s.toLowerCase();
  return ["token", "auth", "expired", "过期", "登录", "unauthorized"].some((kw) =>
    lower.includes(kw),
  );
}

// TowerAI SSE format:  event: text \n data: "<json string>" \n\n
function parseSseText(raw: string): string {
  const parts: string[] = [];
  for (const block of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    if (!block.trim()) continue;
    let eventType = "";
    let data = "";
    for (const line of block.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (field === "event") eventType = value;
      else if (field === "data") data = value;
    }
    if (eventType === "text" && data) {
      try {
        const content = JSON.parse(data);
        if (typeof content === "string") parts.push(content);
      } catch {
        // skip malformed data
      }
    }
  }
  return parts.join("");
}

interface TowerAIState {
  token?: string;
  auth_token?: string;
  base_url?: string;
}

function readStateFile(): TowerAIState {
  try {
    const statePath = path.join(os.homedir(), ".towerai", "state.json");
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw) as TowerAIState;
  } catch {
    return {};
  }
}

function resolveCredentials(): { apiKey: string; authToken: string; baseUrl: string } {
  // Env vars take priority over state file
  const envToken = getEnvVar("TOWERAI_TOKEN");
  if (envToken) {
    return {
      apiKey: envToken,
      authToken: getEnvVar("TOWERAI_AUTH_TOKEN") ?? "",
      baseUrl: (getEnvVar("TOWERAI_BASE_URL") || DEFAULT_BASE_URL).replace(/\/$/, ""),
    };
  }

  // Fall back to ~/.towerai/state.json
  const state = readStateFile();
  if (state.token) {
    return {
      apiKey: state.token,
      authToken: getEnvVar("TOWERAI_AUTH_TOKEN") || state.auth_token || "",
      baseUrl: (getEnvVar("TOWERAI_BASE_URL") || state.base_url || DEFAULT_BASE_URL).replace(/\/$/, ""),
    };
  }

  throw new Error(
    "TowerAI credentials not found. Set TOWERAI_TOKEN env var, or run `towerai connect` to populate ~/.towerai/state.json",
  );
}

export class TowerAIProvider implements MemoryProvider {
  name = "towerai";
  private apiKey: string;
  private authToken: string;
  private model: string;
  private maxTokens: number;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(apiKey: string, model: string, maxTokens: number) {
    // apiKey may be empty string when called from createBaseProvider without TOWERAI_TOKEN —
    // resolveCredentials() will pick up state.json in that case.
    const creds = apiKey ? { apiKey, authToken: getEnvVar("TOWERAI_AUTH_TOKEN") ?? "", baseUrl: (getEnvVar("TOWERAI_BASE_URL") || DEFAULT_BASE_URL).replace(/\/$/, "") } : resolveCredentials();
    this.apiKey = creds.apiKey;
    this.authToken = creds.authToken;
    this.baseUrl = creds.baseUrl;
    this.model = model || getEnvVar("TOWERAI_MODEL") || DEFAULT_MODEL;
    this.maxTokens = maxTokens;
    const rawMs = getEnvVar("AGENTMEMORY_LLM_TIMEOUT_MS");
    const parsed = rawMs ? Number(rawMs) : NaN;
    this.timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt);
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.call(systemPrompt, userPrompt);
  }

  private async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Token: this.apiKey,
    };
    if (this.authToken) {
      headers["X-lobe-chat-auth"] = this.authToken;
    }

    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const endpoints = resolveEndpoints(this.model);
    let lastError: Error | undefined;

    for (const ep of endpoints) {
      const url = `${this.baseUrl}${ep}`;
      let response: Response;
      try {
        response = await fetchWithTimeout(url, { method: "POST", headers, body }, this.timeoutMs);
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        lastError = aborted
          ? new Error(`TowerAI request timed out after ${this.timeoutMs}ms`)
          : err instanceof Error
            ? err
            : new Error(String(err));
        continue;
      }

      const text = await response.text();

      if (!response.ok) {
        // 4xx errors are not retryable on other endpoints
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`TowerAI ${ep} error (${response.status}): ${text.slice(0, 300)}`);
        }
        lastError = new Error(`TowerAI ${ep} error (${response.status}): ${text.slice(0, 300)}`);
        continue;
      }

      // TowerAI may return HTTP 200 with a JSON error body (e.g. expired token)
      if (isTokenError(text)) {
        throw new Error(`TowerAI token error — refresh TOWERAI_TOKEN: ${text.slice(0, 200)}`);
      }

      const content = parseSseText(text);
      if (!content) {
        throw new Error(`TowerAI returned empty content from ${ep}: ${text.slice(0, 200)}`);
      }
      return content;
    }

    throw lastError ?? new Error("TowerAI: all endpoints failed");
  }
}
