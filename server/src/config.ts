import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".videoeditor-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface UserConfig {
  onboarding_complete: boolean;
  vlm_endpoint: string;
  vlm_model: string;
  vlm_api_key: string;
  resolve_script_api: string;
  resolve_script_lib: string;
  media_paths: string[];
}

const DEFAULTS: UserConfig = {
  onboarding_complete: false,
  vlm_endpoint: "",
  vlm_model: "Qwen/Qwen3-VL-32B-Instruct-FP8",
  vlm_api_key: "",
  resolve_script_api:
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
  resolve_script_lib:
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so",
  media_paths: [
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "Movies"),
  ],
};

export async function loadConfig(): Promise<UserConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(
  partial: Partial<UserConfig>
): Promise<UserConfig> {
  const existing = await loadConfig();
  const merged = { ...existing, ...partial, onboarding_complete: true };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export async function needsOnboarding(): Promise<boolean> {
  const config = await loadConfig();
  return !config.onboarding_complete;
}

/** Apply saved config to process.env so VLM client and executor pick them up. */
export async function applyConfigToEnv(): Promise<void> {
  const config = await loadConfig();
  if (!config.onboarding_complete) return;

  if (config.vlm_endpoint && !process.env.CUMULUS_VLM_ENDPOINT) {
    process.env.CUMULUS_VLM_ENDPOINT = config.vlm_endpoint;
  }
  if (config.vlm_model && !process.env.CUMULUS_VLM_MODEL) {
    process.env.CUMULUS_VLM_MODEL = config.vlm_model;
  }
  if (config.vlm_api_key && !process.env.CUMULUS_VLM_API_KEY) {
    process.env.CUMULUS_VLM_API_KEY = config.vlm_api_key;
  }
  if (config.resolve_script_api && !process.env.RESOLVE_SCRIPT_API) {
    process.env.RESOLVE_SCRIPT_API = config.resolve_script_api;
  }
  if (config.resolve_script_lib && !process.env.RESOLVE_SCRIPT_LIB) {
    process.env.RESOLVE_SCRIPT_LIB = config.resolve_script_lib;
  }
}
