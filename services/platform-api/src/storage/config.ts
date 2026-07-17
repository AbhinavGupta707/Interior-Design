import type { RuntimeEnvironment } from "@interior-design/config";

export interface S3AssetStorageConfig {
  readonly accessKeyId: string;
  readonly endpoint: string;
  readonly forcePathStyle: boolean;
  readonly region: string;
  readonly secretAccessKey: string;
}

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const LOCAL_ENDPOINT = "http://127.0.0.1:8333";
const LOCAL_ACCESS_KEY = "localdev";
const LOCAL_SECRET_KEY = "local-development-only";

function requiredProductionValue(environment: StorageEnvironment, variable: string): string {
  const value = environment[variable]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${variable} is required in production.`);
  }
  return value;
}

function parseEndpoint(value: string, runtimeEnvironment: RuntimeEnvironment): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("C2_STORAGE_ENDPOINT must be a valid absolute URL.");
  }

  if (
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0
  ) {
    throw new Error("C2_STORAGE_ENDPOINT cannot contain credentials, query, or fragment data.");
  }

  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  if (runtimeEnvironment === "production") {
    if (endpoint.protocol !== "https:" || isLoopback) {
      throw new Error("Production C2 object storage requires a non-loopback HTTPS endpoint.");
    }
  } else if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLoopback)) {
    throw new Error("C2 object storage uses HTTPS except for loopback development endpoints.");
  }

  return endpoint.toString().replace(/\/$/u, "");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("C2_STORAGE_FORCE_PATH_STYLE must be true or false.");
}

export function loadS3AssetStorageConfig(
  runtimeEnvironment: RuntimeEnvironment,
  environment: StorageEnvironment,
): S3AssetStorageConfig {
  const production = runtimeEnvironment === "production";
  const endpointValue = production
    ? requiredProductionValue(environment, "C2_STORAGE_ENDPOINT")
    : (environment.C2_STORAGE_ENDPOINT ?? LOCAL_ENDPOINT);
  const accessKeyId = production
    ? requiredProductionValue(environment, "C2_STORAGE_ACCESS_KEY_ID")
    : (environment.C2_STORAGE_ACCESS_KEY_ID ?? LOCAL_ACCESS_KEY);
  const secretAccessKey = production
    ? requiredProductionValue(environment, "C2_STORAGE_SECRET_ACCESS_KEY")
    : (environment.C2_STORAGE_SECRET_ACCESS_KEY ?? LOCAL_SECRET_KEY);
  const region = (environment.C2_STORAGE_REGION ?? "local").trim();

  if (accessKeyId.length < 3 || accessKeyId.length > 200) {
    throw new Error("C2_STORAGE_ACCESS_KEY_ID must contain between 3 and 200 characters.");
  }
  if (secretAccessKey.length < 8 || secretAccessKey.length > 500) {
    throw new Error("C2_STORAGE_SECRET_ACCESS_KEY must contain between 8 and 500 characters.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(region)) {
    throw new Error("C2_STORAGE_REGION is invalid.");
  }

  return Object.freeze({
    accessKeyId,
    endpoint: parseEndpoint(endpointValue, runtimeEnvironment),
    forcePathStyle: parseBoolean(environment.C2_STORAGE_FORCE_PATH_STYLE, !production),
    region,
    secretAccessKey,
  });
}
