import { Injectable, Logger } from '@nestjs/common';
import { InvalidPDFException, PasswordException, PDFParse } from 'pdf-parse';

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

// A line must repeat on at least this fraction of pages to be treated as a
// running header/footer rather than real body content.
const HEADER_FOOTER_REPETITION_THRESHOLD = 0.6;

// Page-number lines vary per page ("Page 3 of 12", "- 3 -", bare "3"), so they
// can't be caught by exact-repetition matching - only by pattern.
const PAGE_NUMBER_PATTERNS: RegExp[] = [
  /^page\s+\d+\s+of\s+\d+$/i,
  /^-{0,2}\s*\d+\s*(\/|of)\s*\d+\s*-{0,2}$/i,
  /^-?\s*\d+\s*-?$/,
];

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  async extractText(buffer: Buffer): Promise<ExtractedPdf> {
    let parser: PDFParse | undefined;

    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();

      if (result.total === 0) {
        throw new Error('PDF has no pages');
      }

      const cleanedPages = this.stripHeadersFooters(result.pages.map((page) => page.text));
      const text = cleanedPages
        .map((page) => page.trim())
        .filter((page) => page.length > 0)
        .join('\n\n');

      if (text.length === 0) {
        throw new Error(
          'No extractable text found in this PDF - it may be a scanned/image-only document that requires OCR',
        );
      }

      return { text, pageCount: result.total };
    } catch (error) {
      if (error instanceof PasswordException) {
        this.logger.error('PDF extraction failed: document is password-protected');
        throw new Error('Failed to extract text from PDF: document is password-protected');
      }

      if (error instanceof InvalidPDFException) {
        this.logger.error('PDF extraction failed: invalid/corrupted PDF structure');
        throw new Error(
          'Failed to extract text from PDF: the file is corrupted or not a valid PDF',
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`PDF extraction failed: ${message}`);
      throw new Error(`Failed to extract text from PDF: ${message}`);
    } finally {
      await parser?.destroy();
    }
  }

  private stripHeadersFooters(pageTexts: string[]): string[] {
    const linesByPage = pageTexts.map((text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );

    const boilerplateLines = this.detectRepeatingLines(linesByPage);

    return linesByPage.map((lines) =>
      lines
        .filter((line) => !boilerplateLines.has(line) && !this.isPageNumberLine(line))
        .join('\n'),
    );
  }

  private detectRepeatingLines(linesByPage: string[][]): Set<string> {
    if (linesByPage.length <= 1) {
      // Can't detect a "repeating" line with only one page to compare against.
      return new Set();
    }

    const lineFrequency = new Map<string, number>();
    for (const lines of linesByPage) {
      for (const line of new Set(lines)) {
        lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
      }
    }

    const minRepetitions = Math.max(
      2,
      Math.ceil(linesByPage.length * HEADER_FOOTER_REPETITION_THRESHOLD),
    );

    return new Set(
      [...lineFrequency.entries()]
        .filter(([, count]) => count >= minRepetitions)
        .map(([line]) => line),
    );
  }

  private isPageNumberLine(line: string): boolean {
    return PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(line));
  }
}
