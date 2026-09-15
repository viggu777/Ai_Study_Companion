/**
 * Chunking helpers — phase 06 RAG pipeline
 * ~500-800 tokens per chunk, ~50-100 overlap
 * Approximation: 1 token ≈ 4 chars → 600 tokens ≈ 2400 chars, overlap 80 tokens ≈ 320 chars
 */

export interface RawChunk {
  content: string;
  page_number: number;
  chunk_index: number;
}

const CHUNK_SIZE_CHARS = 2400;
const OVERLAP_CHARS = 320;

export function chunkText(
  segments: { text: string; pageNumber: number }[]
): RawChunk[] {
  const chunks: RawChunk[] = [];
  let chunkIndex = 0;

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    // Split long segment into overlapping windows
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
      const slice = text.slice(start, end).trim();
      if (slice.length > 50) {
        chunks.push({
          content: slice,
          page_number: seg.pageNumber,
          chunk_index: chunkIndex++,
        });
      }
      if (end >= text.length) break;
      start = end - OVERLAP_CHARS;
    }
  }

  // If no segments (empty doc), return empty
  return chunks;
}

export function chunkPlainText(fullText: string, pageCount: number): RawChunk[] {
  // Fallback when we only have full text + page count: estimate page splits
  if (!fullText.trim()) return [];
  const estimatedPages = Math.max(1, pageCount);
  const approxPerPage = Math.ceil(fullText.length / estimatedPages);
  const segments: { text: string; pageNumber: number }[] = [];
  for (let p = 0; p < estimatedPages; p++) {
    const start = p * approxPerPage;
    const end = Math.min(start + approxPerPage, fullText.length);
    const slice = fullText.slice(start, end);
    if (slice.trim()) segments.push({ text: slice, pageNumber: p + 1 });
  }
  // If estimation yields single segment, just chunk whole
  if (segments.length === 0) segments.push({ text: fullText, pageNumber: 1 });
  return chunkText(segments);
}
