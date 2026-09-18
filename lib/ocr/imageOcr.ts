/**
 * Free offline image OCR — lib/ocr/imageOcr.ts
 *
 * Stack: sharp (preprocess) + tesseract.js (WASM OCR, eng only).
 * 100% free, no API key, works on Vercel serverless.
 *
 * Vercel notes:
 * - Filesystem is read-only except /tmp → tesseract cachePath MUST be /tmp
 *   (default '.' would try to write traineddata to the read-only bundle).
 * - worker_threads are supported; always terminate() the worker in finally
 *   so frozen serverless instances don't leak memory/time.
 * - Dynamic imports keep WASM/sharp out of the build trace (see next.config).
 */

const OCR_TIMEOUT_MS = 50_000;
const TESSERACT_CACHE_PATH = "/tmp";

export const ALLOWED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const ALLOWED_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export function normalizeImageMime(mimeType: string, filename: string): string | null {
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim();
  if ((ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)) return mime;
  // Some browsers send octet-stream / empty for images — fall back to extension.
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

export function isImageFile(mimeType: string, filename: string): boolean {
  return normalizeImageMime(mimeType, filename) !== null;
}

/** Quick magic-byte sniff so text files renamed to .png fail fast with a clear error. */
function hasKnownImageSignature(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return true;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return true;
  return false;
}

/**
 * Normalize uploads for OCR: auto-rotate (EXIF), grayscale, contrast
 * normalize, upscale small images to ~2000px wide, output PNG.
 * Throws an actionable error for corrupt/unsupported files.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buffer, { failOn: "none" })
      .rotate() // auto-orient via EXIF — phone photos are often rotated
      .grayscale()
      .normalize()
      .resize({ width: 2000, withoutEnlargement: true, fit: "inside" })
      .png()
      .toBuffer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Image preprocessing failed (corrupt or unsupported image?): ${msg}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Run OCR on multiple image buffers sharing a single worker.
 * Much faster than one worker per image (language data loads once).
 * Returns raw texts in input order (empty string = no text detected).
 */
export async function ocrImageBuffers(buffers: Buffer[]): Promise<string[]> {
  if (buffers.length === 0) return [];
  const cleaned = await Promise.all(buffers.map((b) => preprocessImage(b)));

  // Dynamic import: keeps tesseract WASM out of the Next build trace and
  // loads only on the server at request time.
  const { createWorker } = await import("tesseract.js");
  // OEM 1 = LSTM_ONLY (default engine). cachePath /tmp is REQUIRED on Vercel
  // (only writable dir); default '.' would fail on the read-only bundle.
  const worker = await withTimeout(
    createWorker("eng", 1, { cachePath: TESSERACT_CACHE_PATH } as never),
    OCR_TIMEOUT_MS,
    "OCR worker failed to start in time — try again (cold start downloads language data once)"
  );

  try {
    const texts: string[] = [];
    for (const img of cleaned) {
      const result = await withTimeout(
        worker.recognize(img),
        OCR_TIMEOUT_MS,
        "OCR timed out — image may be too large or complex. Try a smaller, clearer image."
      );
      texts.push((result?.data?.text ?? "").trim());
    }
    return texts;
  } finally {
    try {
      await worker.terminate();
    } catch {
      // ignore — worker cleanup is best-effort
    }
  }
}

/**
 * Run OCR on an image buffer. Returns raw text (may be empty — caller
 * decides the minimum-length threshold, same as the PDF path).
 */
export async function extractImageText(buffer: Buffer): Promise<{ text: string; method: string }> {
  if (!buffer || buffer.length === 0) throw new Error("Image is empty");
  if (!hasKnownImageSignature(buffer)) {
    throw new Error("File is not a valid PNG/JPEG/WebP image (bad signature)");
  }

  const [text] = await ocrImageBuffers([buffer]);
  return { text: text ?? "", method: "sharp+tesseract" };
}
