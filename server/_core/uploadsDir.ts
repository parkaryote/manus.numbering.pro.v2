import fs from "fs";
import path from "path";

function isUsableDir(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) return false;
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function resolveUploadsDir(): string {
  const explicit = process.env.LOCAL_UPLOAD_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  // Railway volume mount path (if a persistent volume is attached)
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayVolumeMount) {
    return path.resolve(railwayVolumeMount, "uploads");
  }

  // Common persistent mount locations in managed runtimes
  const persistentCandidates =
    process.env.NODE_ENV === "production"
      ? ["/data/uploads", "/mnt/data/uploads"]
      : [];
  for (const candidate of persistentCandidates) {
    const parent = path.dirname(candidate);
    if (isUsableDir(parent)) {
      return candidate;
    }
  }

  // Local/dev fallback
  return path.resolve(process.cwd(), "var", "uploads");
}

