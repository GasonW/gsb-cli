export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, unknown>;

export interface Issue extends Record<string, unknown> {
  code: string;
  severity: "error" | "warning" | "info";
  status: "fail" | "warn" | "info";
  problem: string;
  evidence: JsonObject;
  why: string;
  next_step: string;
  continue_after_fix?: {
    command: string;
    intent: string;
    precondition: string;
  };
}

export interface CliGlobals {
  baseUrl?: string;
  profile: string;
  username?: string;
  password?: string;
  json: boolean;
  help: boolean;
  version: boolean;
  rawArgv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface CliResult {
  payload: JsonObject;
  exitCode: number;
}

export interface SessionData {
  base_url?: string;
  username?: string;
  role?: string;
  session_token?: string;
}

export interface DatasetInfo {
  path: string;
  exists: boolean;
  is_dir: boolean;
  json_files: string[];
  valid_json_files: string[];
  invalid_json_files: JsonObject[];
  non_object_json_files: JsonObject[];
  non_json_files: string[];
  nested_json_files: string[];
  convertible_files: string[];
  sample_keys: Record<string, string[]>;
  recognized_default_field_files: number;
  conversion_plan: JsonObject | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  sessionToken?: string;
  timeoutMs?: number;
}
