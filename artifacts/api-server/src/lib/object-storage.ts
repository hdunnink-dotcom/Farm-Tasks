import { randomUUID } from "crypto";
import type { File, Storage } from "@google-cloud/storage";

// Legacy Replit App Storage (only reachable on Replit, via its sidecar).
// Loaded lazily so hosts without the sidecar or package never touch it; all
// current attachments live in Google Drive.
const sidecar = "http://127.0.0.1:1106";

let storagePromise: Promise<Storage> | undefined;

function legacyStorage(): Promise<Storage> {
  storagePromise ??= import("@google-cloud/storage").then(({ Storage: StorageClient }) => new StorageClient({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${sidecar}/token`,
      type: "external_account",
      credential_source: {
        url: `${sidecar}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  }));
  return storagePromise;
}

function privateDirectory(): string {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return value.replace(/\/$/, "");
}

function parseObjectPath(path: string): { bucket: string; key: string } {
  const parts = path.replace(/^\//, "").split("/");
  if (parts.length < 2) throw new Error("Invalid App Storage object path.");
  return { bucket: parts[0], key: parts.slice(1).join("/") };
}

function toObjectPath(signedUrl: string): string {
  const path = new URL(signedUrl).pathname;
  const directory = privateDirectory();
  return `/objects/${path.slice(directory.length + 1)}`;
}

async function sign(bucket: string, key: string, method: "PUT" | "GET" | "DELETE"): Promise<string> {
  const response = await fetch(`${sidecar}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: key,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object Storage signing failed (${response.status}).`);
  const data = (await response.json()) as { signed_url: string };
  return data.signed_url;
}

export async function createPrivateUploadUrl(): Promise<{ uploadUrl: string; objectPath: string }> {
  const { bucket, key: prefix } = parseObjectPath(privateDirectory());
  const key = `${prefix}/uploads/${randomUUID()}`;
  const uploadUrl = await sign(bucket, key, "PUT");
  return { uploadUrl, objectPath: toObjectPath(uploadUrl) };
}

export async function createPrivateDownloadUrl(objectPath: string): Promise<string> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid protected object path.");
  const { bucket, key: prefix } = parseObjectPath(privateDirectory());
  const key = `${prefix}/${objectPath.slice("/objects/".length)}`;
  return sign(bucket, key, "GET");
}

export async function getPrivateObject(objectPath: string): Promise<File> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid protected object path.");
  const { bucket, key: prefix } = parseObjectPath(privateDirectory());
  const key = `${prefix}/${objectPath.slice("/objects/".length)}`;
  const file = (await legacyStorage()).bucket(bucket).file(key);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Attachment object not found.");
  return file;
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  const file = await getPrivateObject(objectPath);
  await file.delete({ ignoreNotFound: true });
}