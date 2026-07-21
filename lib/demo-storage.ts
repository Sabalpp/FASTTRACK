import type { AppState, JobPhoto } from "@/lib/types";

const MAX_EMBEDDED_PHOTOS = 6;
const MAX_EMBEDDED_PHOTO_CHARS = 500_000;
const MAX_EMBEDDED_MEDIA_CHARS = 1_600_000;

type WritableStorage = Pick<Storage, "setItem">;

function isEmbeddedPhoto(photo: JobPhoto) {
  return photo.storagePath.startsWith("data:image/");
}

function isTransientPhoto(photo: JobPhoto) {
  return photo.storagePath.startsWith("blob:");
}

/**
 * Keeps hosted demo data comfortably below Safari's small localStorage quota.
 * Remote photos are always retained. Newest embedded previews are retained only
 * while they fit a conservative budget; transient blob URLs are never persisted.
 */
export function compactDemoStateForStorage(state: AppState): AppState {
  let embeddedCount = 0;
  let embeddedChars = 0;

  const jobPhotos = state.jobPhotos.filter((photo) => {
    if (isTransientPhoto(photo)) return false;
    if (!isEmbeddedPhoto(photo)) return true;

    const photoChars = photo.storagePath.length;
    if (
      photoChars > MAX_EMBEDDED_PHOTO_CHARS
      || embeddedCount >= MAX_EMBEDDED_PHOTOS
      || embeddedChars + photoChars > MAX_EMBEDDED_MEDIA_CHARS
    ) {
      return false;
    }

    embeddedCount += 1;
    embeddedChars += photoChars;
    return true;
  });

  return jobPhotos.length === state.jobPhotos.length ? state : { ...state, jobPhotos };
}

function withoutEmbeddedPhotos(state: AppState): AppState {
  return {
    ...state,
    jobPhotos: state.jobPhotos.filter((photo) => !isEmbeddedPhoto(photo) && !isTransientPhoto(photo))
  };
}

/**
 * localStorage writes can throw QuotaExceededError on iPad Safari. Demo storage
 * is optional, so a failed write must never take down the application.
 */
export function persistDemoState(storage: WritableStorage, key: string, state: AppState): boolean {
  const compacted = compactDemoStateForStorage(state);

  try {
    storage.setItem(key, JSON.stringify(compacted));
    return true;
  } catch (error) {
    console.warn("Demo storage was full; retrying without embedded photo previews.", error);
  }

  try {
    storage.setItem(key, JSON.stringify(withoutEmbeddedPhotos(compacted)));
    return false;
  } catch (error) {
    console.warn("Demo state could not be saved to localStorage.", error);
    return false;
  }
}
