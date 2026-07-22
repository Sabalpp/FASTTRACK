const MAX_PREVIEW_EDGE = 1280;
const PREVIEW_QUALITY = 0.72;

export async function createPhotoPreview(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return readFileAsDataUrl(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo preview is unavailable on this device.");
    context.drawImage(image, 0, 0, width, height);
    const preview = canvas.toDataURL("image/jpeg", PREVIEW_QUALITY);
    if (!preview.startsWith("data:image/jpeg")) throw new Error("The selected photo could not be converted to JPEG.");
    return preview;
  } catch {
    if (/^image\/(jpe?g|png)$/i.test(file.type)) return readFileAsDataUrl(file);
    throw new Error("This camera photo could not be converted to JPEG. Choose a JPG or PNG image, or take a screenshot and upload it.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected photo could not be read."));
    image.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The selected photo could not be read."));
    reader.readAsDataURL(file);
  });
}
