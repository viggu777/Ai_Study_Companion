/**
 * Free scanned-PDF OCR — lib/ocr/scannedPdfOcr.ts
 *
 * PRD §5 requires: "Documents may contain normal text, tables, images,
 * diagrams, or scanned pages" with a "Processing / OCR" pipeline stage.
 * pdf-parse recovers selectable text but returns ~empty for scanned /
 * image-only PDFs, so this module renders those pages to PNG (pdfjs-dist +
 * @napi-rs/canvas — both pure JS + prebuilt binaries, no apt/poppler needed,
 * Vercel-serverless safe) and OCRs them with the existing sharp+tesseract
 * pipeline, preserving real page numbers for citations.
 *
 * Budget guard: rendering + OCR costs ~5-10s per page cold. MAX pages keeps
 * the job inside the 60s Vercel function limit for the assignment demo.
 * Larger scanned PDFs fail with an actionable message (split / upload key
 * pages as images).
 */

import { ocrImageBuffers } from "./imageOcr";

export const MAX_SCANNED_OCR_PAGES = 5;
const RENDER_SCALE = 2.0; // ~144-200 DPI — sharp enough for Tesseract, small enough for RAM
const RENDER_TIMEOUT_MS = 30_000;

export interface PdfPageSegment {
  text: string;
  pageNumber: number;
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

/** Minimal canvas factory pdfjs needs — backed by @napi-rs/canvas (prebuilt, Vercel-safe). */
async function createCanvasFactory(): Promise<{
  create: (w: number, h: number) => { canvas: { width: number; height: number; toBuffer: (mime: string) => Buffer }; context: unknown };
  destroy: (c: { canvas: { width: number; height: number } }) => void;
}> {
  const { createCanvas } = await import("@napi-rs/canvas");
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.floor(width), Math.floor(height));
      const context = canvas.getContext("2d") as unknown;
      return {
        canvas: canvas as unknown as { width: number; height: number; toBuffer: (mime: string) => Buffer },
        context,
      };
    },
    destroy(canvasAndContext: { canvas: { width: number; height: number } }) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    },
  };
}

interface PdfJsPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: unknown) => { promise: Promise<void> };
  cleanup: () => void;
}

interface PdfJsDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfJsPage>;
  destroy: () => Promise<void>;
}

/**
 * Render 1-indexed PDF pages to PNG buffers (sequential — keeps serverless
 * RAM flat). Throws an actionable error on corrupt PDFs.
 */
export async function renderPdfPagesToPngBuffers(
  pdfBuffer: Buffer,
  opts?: { maxPages?: number; scale?: number }
): Promise<{ images: Buffer[]; numPages: number }> {
  const maxPages = opts?.maxPages ?? MAX_SCANNED_OCR_PAGES;
  const scale = opts?.scale ?? RENDER_SCALE;

  // Dynamic imports: keeps pdfjs + canvas WASM/binaries out of the Next
  // build trace; loaded server-side at request time only.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (opts: unknown) => { promise: Promise<PdfJsDoc> };
  };
  const canvasFactory = await createCanvasFactory();

  let doc: PdfJsDoc | null = null;
  try {
    try {
      doc = await withTimeout(
        pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true, isEvalSupported: false }).promise,
        RENDER_TIMEOUT_MS,
        "PDF parsing timed out — the file may be corrupt"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Scanned-PDF rendering failed (unreadable PDF?): ${msg}`);
    }

    const numPages = doc.numPages ?? 0;
    if (numPages === 0) throw new Error("Scanned-PDF rendering failed: no pages found");
    if (numPages > maxPages) {
      throw new Error(
        `This scanned PDF has ${numPages} pages, but free OCR supports up to ${maxPages} pages per file (Vercel time limit). Split the PDF or upload the key pages as PNG/JPG images instead.`
      );
    }

    const images: Buffer[] = [];
    for (let n = 1; n <= numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const viewport = page.getViewport({ scale });
        const created = canvasFactory.create(viewport.width, viewport.height);
        try {
          await withTimeout(
            page.render({ canvasContext: created.context, viewport, canvasFactory }).promise,
            RENDER_TIMEOUT_MS,
            `Rendering PDF page ${n} timed out`
          );
          images.push(created.canvas.toBuffer("image/png"));
        } finally {
          canvasFactory.destroy(created);
        }
      } finally {
        page.cleanup();
      }
    }
    return { images, numPages };
  } finally {
    try {
      await doc?.destroy();
    } catch {
      // ignore — cleanup is best-effort
    }
  }
}

/**
 * Full scanned-PDF fallback: render pages → OCR each → per-page segments.
 * Pages with no detectable text are skipped but page numbers stay accurate
 * (segment.pageNumber is the real PDF page — citations stay traceable).
 */
export async function extractScannedPdfText(
  pdfBuffer: Buffer,
  opts?: { maxPages?: number }
): Promise<{ segments: PdfPageSegment[]; numPages: number; method: string }> {
  const { images, numPages } = await renderPdfPagesToPngBuffers(pdfBuffer, opts);
  const texts = await ocrImageBuffers(images);
  const segments: PdfPageSegment[] = texts
    .map((text, i) => ({ text, pageNumber: i + 1 }))
    .filter((s) => s.text.trim().length > 0);
  return { segments, numPages, method: "pdfjs+sharp+tesseract" };
}

/** Join page segments for the concept-extraction prompt (same 8000-char window as text PDFs). */
export function joinSegmentsForPrompt(segments: PdfPageSegment[], maxChars = 8000): string {
  return segments.map((s) => `[Page ${s.pageNumber}]\n${s.text}`).join("\n\n").slice(0, maxChars);
}
