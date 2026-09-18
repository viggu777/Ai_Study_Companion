import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Mock the OCR engine (network/WASM heavy) — rendering stays real.
vi.mock("@/lib/ocr/imageOcr", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ocr/imageOcr")>();
  return {
    ...mod,
    ocrImageBuffers: vi.fn(async (buffers: Buffer[]) =>
      buffers.map((_, i) => `MOCK OCR TEXT PAGE ${i + 1}`)
    ),
  };
});

import { ocrImageBuffers } from "@/lib/ocr/imageOcr";
import {
  MAX_SCANNED_OCR_PAGES,
  extractScannedPdfText,
  joinSegmentsForPrompt,
  renderPdfPagesToPngBuffers,
} from "@/lib/ocr/scannedPdfOcr";

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", name));

describe("scanned-PDF OCR fallback (PRD §5: scanned pages)", () => {
  it("renders each page to a PNG buffer", async () => {
    const { images, numPages } = await renderPdfPagesToPngBuffers(fixture("scanned-2pages.pdf"));
    expect(numPages).toBe(2);
    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img[0]).toBe(0x89); // PNG signature
      expect(img[1]).toBe(0x50);
    }
  });

  it("returns per-page segments with real page numbers", async () => {
    const { segments, numPages, method } = await extractScannedPdfText(
      fixture("scanned-2pages.pdf")
    );
    expect(numPages).toBe(2);
    expect(method).toBe("pdfjs+sharp+tesseract");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.pageNumber).toBe(1);
    expect(segments[1]?.pageNumber).toBe(2);
    // OCR ran once per rendered page (shared worker path)
    expect(ocrImageBuffers).toHaveBeenCalledTimes(1);
  });

  it("skips pages with no detectable text but keeps page numbers accurate", async () => {
    vi.mocked(ocrImageBuffers).mockResolvedValueOnce(["", "second page text"]);
    const { segments } = await extractScannedPdfText(fixture("scanned-2pages.pdf"));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text: "second page text", pageNumber: 2 });
  });

  it(`rejects scanned PDFs over the free page cap (${MAX_SCANNED_OCR_PAGES})`, async () => {
    await expect(extractScannedPdfText(fixture("scanned-6pages.pdf"))).rejects.toThrow(
      /up to 5 pages/
    );
  });

  it("joinSegmentsForPrompt tags pages and caps length", () => {
    const joined = joinSegmentsForPrompt(
      [
        { text: "alpha", pageNumber: 1 },
        { text: "beta", pageNumber: 3 },
      ],
      100
    );
    expect(joined).toContain("[Page 1]\nalpha");
    expect(joined).toContain("[Page 3]\nbeta");
    expect(joined.length).toBeLessThanOrEqual(100);
  });
});
