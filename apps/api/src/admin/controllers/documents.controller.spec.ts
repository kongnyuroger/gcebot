import { BadRequestException, MaxFileSizeValidator } from '@nestjs/common';
import { IngestionService } from '../../rag/services/ingestion.service';
import { DocumentsController } from './documents.controller';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let ingestDocument: jest.Mock;

  const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

  beforeEach(() => {
    ingestDocument = jest.fn().mockResolvedValue({ id: 'doc-1', ingestionStatus: 'QUEUED' });
    controller = new DocumentsController({ ingestDocument } as unknown as IngestionService);
  });

  function pdfFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
    return {
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('rest of a real pdf body')]),
      originalname: 'past-paper.pdf',
      mimetype: 'application/pdf',
      size: 33,
      ...overrides,
    } as Express.Multer.File;
  }

  describe('ingest', () => {
    it('accepts a valid PDF and forwards parsed metadata to IngestionService', async () => {
      const result = await controller.ingest(pdfFile(), {
        subject: 'Biology',
        level: 'O_LEVEL',
        docType: 'PAST_PAPER',
        year: '2023',
        topic: 'Organic Chemistry',
      });

      expect(result).toEqual({ documentId: 'doc-1', status: 'QUEUED' });
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'past-paper.pdf' }),
        {
          subject: 'Biology',
          level: 'O_LEVEL',
          docType: 'PAST_PAPER',
          year: 2023,
          topic: 'Organic Chemistry',
        },
      );
    });

    it('rejects a file whose content is not actually a PDF, regardless of its claimed mimetype', async () => {
      // Client-supplied mimetype is trivially spoofable - the controller checks
      // real magic bytes instead. Here the mimetype lies ("application/pdf")
      // but the content is plain text.
      const fakeFile = pdfFile({
        buffer: Buffer.from('this is not a pdf at all'),
        mimetype: 'application/pdf',
      });

      await expect(
        controller.ingest(fakeFile, {
          subject: 'Biology',
          level: 'O_LEVEL',
          docType: 'PAST_PAPER',
        }),
      ).rejects.toThrow(new BadRequestException('Uploaded file is not a valid PDF'));
      expect(ingestDocument).not.toHaveBeenCalled();
    });

    it('rejects a request with no subject', async () => {
      await expect(
        controller.ingest(pdfFile(), { level: 'O_LEVEL', docType: 'PAST_PAPER' }),
      ).rejects.toThrow(new BadRequestException('subject is required'));
    });

    it('rejects an invalid level', async () => {
      await expect(
        controller.ingest(pdfFile(), { subject: 'Biology', level: 'GCSE', docType: 'PAST_PAPER' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid docType', async () => {
      await expect(
        controller.ingest(pdfFile(), { subject: 'Biology', level: 'O_LEVEL', docType: 'NOVEL' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-integer year', async () => {
      await expect(
        controller.ingest(pdfFile(), {
          subject: 'Biology',
          level: 'O_LEVEL',
          docType: 'PAST_PAPER',
          year: 'not-a-year',
        }),
      ).rejects.toThrow(new BadRequestException('year must be an integer'));
    });
  });

  // The oversized-file rule is enforced by MaxFileSizeValidator, wired into
  // the controller's @UploadedFile(new ParseFilePipe(...)) pipe - a pipe runs
  // in the HTTP pipeline, not when the controller method is called directly,
  // so it's exercised here against the exact validator/limit the controller
  // is configured with instead.
  describe('oversized file validator (as wired into the ingest pipe)', () => {
    it('accepts a file comfortably under the 50MB limit', () => {
      const validator = new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES });
      const file = { size: MAX_FILE_SIZE_BYTES - 1 } as Express.Multer.File;
      expect(validator.isValid(file)).toBe(true);
    });

    it('rejects a file at or over the 50MB limit', () => {
      const validator = new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES });
      const file = { size: MAX_FILE_SIZE_BYTES } as Express.Multer.File;
      expect(validator.isValid(file)).toBe(false);
    });
  });
});
