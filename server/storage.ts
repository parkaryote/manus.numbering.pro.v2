// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import fs from "fs/promises";
import path from "path";
import { ENV } from "./_core/env.js";
import { resolveUploadsDir } from "./_core/uploadsDir.js";

type RemoteStorageConfig = { kind: "remote"; baseUrl: string; apiKey: string };
type LocalStorageConfig = { kind: "local"; uploadsDir: string };
type StorageConfig = RemoteStorageConfig | LocalStorageConfig;

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl?.trim() ?? "";
  const apiKey = ENV.forgeApiKey?.trim() ?? "";

  if (baseUrl && apiKey) {
    return { kind: "remote", baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
  }

  const uploadsDir =
    resolveUploadsDir();
  return {
    kind: "local",
    uploadsDir,
  };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  const normalized = relKey.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Invalid storage key");
  }
  return normalized;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const config = getStorageConfig();

  if (config.kind === "local") {
    const absolutePath = path.resolve(config.uploadsDir, key);
    const uploadsRoot = path.resolve(config.uploadsDir);
    if (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`) && absolutePath !== uploadsRoot) {
      throw new Error("Refusing to write outside LOCAL_UPLOAD_DIR");
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    const payload =
      typeof data === "string"
        ? Buffer.from(data, "utf8")
        : Buffer.from(data);
    await fs.writeFile(absolutePath, payload);

    const encodedPath = key
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return { key, url: `/uploads/${encodedPath}` };
  }

  const uploadUrl = buildUploadUrl(config.baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(config.apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const key = normalizeKey(relKey);
  const config = getStorageConfig();

  if (config.kind === "local") {
    const encodedPath = key
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return {
      key,
      url: `/uploads/${encodedPath}`,
    };
  }

  return {
    key,
    url: await buildDownloadUrl(config.baseUrl, key, config.apiKey),
  };
}
