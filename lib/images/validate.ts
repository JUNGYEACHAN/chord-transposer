const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/pjpeg",
]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function resolveImageMimeType(
  file: Pick<File, "name" | "type">,
): string | null {
  const type = file.type.toLowerCase();
  if (ALLOWED_TYPES.has(type)) {
    return type === "image/jpg" || type === "image/pjpeg"
      ? "image/jpeg"
      : type;
  }

  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (ext && ext in EXT_TO_MIME) {
    return EXT_TO_MIME[ext];
  }

  return null;
}

export function validateImageFile(file: File): string | null {
  if (!resolveImageMimeType(file)) {
    return "JPEG 또는 PNG 이미지만 업로드할 수 있습니다.";
  }
  return null;
}

export function isImageFile(file: File): boolean {
  return resolveImageMimeType(file) !== null;
}
