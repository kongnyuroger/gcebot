import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminRole, DocType, IngestionStatus, Level } from '../../../generated/prisma';
import { IngestionService, PaginatedDocuments } from '../../rag/services/ingestion.service';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { Roles } from '../auth/roles.decorator';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
// The first bytes of any valid PDF - a real content check, since the
// client-supplied mimetype is trivially spoofable and this file feeds
// straight into pdf-parse downstream.
const PDF_MAGIC_BYTES = Buffer.from('%PDF-');

interface IngestRequestBody {
  subject?: string;
  level?: string;
  docType?: string;
  year?: string;
  paperNumber?: string;
  topic?: string;
}

interface IngestResponse {
  documentId: string;
  status: IngestionStatus;
}

@Controller('admin/documents')
@UseGuards(AdminJwtGuard, AdminRoleGuard)
@Roles(AdminRole.CONTENT_MANAGER, AdminRole.SUPER_ADMIN)
export class DocumentsController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('ingest')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async ingest(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body() body: IngestRequestBody,
  ): Promise<IngestResponse> {
    if (!file.buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES)) {
      throw new BadRequestException('Uploaded file is not a valid PDF');
    }

    const { subject, docType, topic } = body;
    const level = this.parseLevel(body.level);
    const parsedDocType = this.parseDocType(docType);
    const year = this.parseYear(body.year);
    const paperNumber = this.parsePaperNumber(body.paperNumber);

    if (!subject) {
      throw new BadRequestException('subject is required');
    }

    const document = await this.ingestionService.ingestDocument(file, {
      subject,
      level,
      docType: parsedDocType,
      year,
      paperNumber,
      topic,
    });

    return { documentId: document.id, status: document.ingestionStatus };
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('subject') subject?: string,
  ): Promise<PaginatedDocuments> {
    const parsedPage = page ? Number(page) : 1;
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new BadRequestException('page must be a positive integer');
    }

    const parsedStatus = status ? this.parseStatus(status) : undefined;

    return this.ingestionService.listDocuments(parsedPage, parsedStatus, subject);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.ingestionService.getIngestionStatus(id);
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.ingestionService.retryIngestion(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.ingestionService.deleteDocument(id);
    return { deleted: true };
  }

  private parseLevel(value?: string): Level {
    if (value !== Level.O_LEVEL && value !== Level.A_LEVEL) {
      throw new BadRequestException(`level must be one of: ${Level.O_LEVEL}, ${Level.A_LEVEL}`);
    }
    return value;
  }

  private parseDocType(value?: string): DocType {
    const validTypes = Object.values(DocType);
    if (!value || !validTypes.includes(value as DocType)) {
      throw new BadRequestException(`docType must be one of: ${validTypes.join(', ')}`);
    }
    return value as DocType;
  }

  private parseYear(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const year = Number(value);
    if (!Number.isInteger(year)) {
      throw new BadRequestException('year must be an integer');
    }
    return year;
  }

  private parsePaperNumber(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const paperNumber = Number(value);
    if (!Number.isInteger(paperNumber) || paperNumber < 1) {
      throw new BadRequestException('paperNumber must be a positive integer');
    }
    return paperNumber;
  }

  private parseStatus(value: string): IngestionStatus {
    const validStatuses = Object.values(IngestionStatus);
    if (!validStatuses.includes(value as IngestionStatus)) {
      throw new BadRequestException(`status must be one of: ${validStatuses.join(', ')}`);
    }
    return value as IngestionStatus;
  }
}
