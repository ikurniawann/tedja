import fs from "fs/promises";
import path from "path";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

// Ekstensi diturunkan dari MIME TERVALIDASI, bukan nama file kiriman klien
// (hasil security review: filename "evil.svg" + Content-Type image/png dulu
// tersimpan ber-ekstensi svg → celah stored-XSS saat disajikan).
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

function safeExtension(file: File | Buffer): string {
  if (!(file instanceof File)) return "bin";
  const fromMime = MIME_EXTENSIONS[file.type];
  if (fromMime) return fromMime;
  // MIME tak dikenal → pakai ekstensi nama file HANYA bila alfanumerik pendek
  const raw = file.name.split(".").pop() ?? "";
  return /^[a-z0-9]{1,5}$/i.test(raw) ? raw.toLowerCase() : "bin";
}

/**
 * Upload file ke storage lokal (filesystem / object storage).
 * File disimpan di storage/uploads/{bucket}/...
 */
export async function uploadFile(
  bucket: string,
  file: File | Buffer,
  folder: string = ""
): Promise<{ url: string; error: string | null }> {
  try {
    const fileBuffer = file instanceof File ? Buffer.from(await file.arrayBuffer()) : file;
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = safeExtension(file);
    const fileName = folder
      ? `${folder}/${timestamp}-${random}.${ext}`
      : `${timestamp}-${random}.${ext}`;

    const dir = path.join(UPLOAD_ROOT, bucket);
    const absPath = path.join(dir, fileName);
    await ensureDir(path.dirname(absPath));
    await fs.writeFile(absPath, fileBuffer);

    const url = `/api/files/${bucket}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
    return { url, error: null };
  } catch (err: unknown) {
    return {
      url: "",
      error: err instanceof Error ? err.message : "Upload gagal",
    };
  }
}

export async function deleteFile(bucket: string, fileUrl: string): Promise<{ error: string | null }> {
  try {
    const prefix = `/api/files/${bucket}/`;
    const idx = fileUrl.indexOf(prefix);
    if (idx === -1) return { error: "Invalid file URL" };
    const rel = decodeURIComponent(fileUrl.slice(idx + prefix.length));
    const absPath = path.join(UPLOAD_ROOT, bucket, rel);
    await fs.unlink(absPath);
    return { error: null };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : null };
  }
}

export function getPublicUrl(bucket: string, filePath: string): string {
  return `/api/files/${bucket}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "Ukuran file maksimal 10 MB" };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "Tipe file tidak didukung" };
  }
  return { valid: true };
}
