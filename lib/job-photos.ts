export const MAX_JOB_PHOTO_CAPTION_LENGTH = 240;
export const MAX_JOB_PHOTO_UPLOAD_BYTES = 12 * 1024 * 1024;

export function normalizeJobPhotoCaption(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (normalized.length <= MAX_JOB_PHOTO_CAPTION_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_JOB_PHOTO_CAPTION_LENGTH - 1).trimEnd()}…`;
}

export function displayJobPhotoCaption(value?: string): string {
  return normalizeJobPhotoCaption(value) ?? "Job photo";
}
