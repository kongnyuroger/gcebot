import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSendService } from '../../whatsapp/services/whatsapp-send.service';
import { BroadcastService } from '../services/broadcast.service';
import { BroadcastStatus } from '../../../generated/prisma';
import {
  BROADCAST_JOB_NAME,
  BROADCAST_QUEUE_NAME,
  BroadcastJobPayload,
} from '../queues/broadcast.queue';

// WhatsApp Cloud API rate limits business-initiated sends - a small delay
// between each message, batched, keeps a large broadcast well under them.
const BATCH_SIZE = 50;
const SEND_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NOTE: WhatsApp requires an approved message template for business-initiated
// messages outside the 24h customer-service window - this plain sendText()
// call must be swapped for a registered template before broadcasts can
// actually send in production (same requirement as WeeklyReportService).
@Processor(BROADCAST_QUEUE_NAME)
export class BroadcastProcessor {
  private readonly logger = new Logger(BroadcastProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly broadcastService: BroadcastService,
  ) {}

  @Process(BROADCAST_JOB_NAME)
  async handleBroadcast(job: Job<BroadcastJobPayload>): Promise<void> {
    const { broadcastId } = job.data;
    const broadcast = await this.prisma.broadcast.findUnique({ where: { id: broadcastId } });

    if (!broadcast) {
      this.logger.warn(`handleBroadcast: broadcast ${broadcastId} not found`);
      return;
    }

    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.PROCESSING },
    });

    // Re-resolves recipients now rather than trusting totalRecipients from
    // creation time - a scheduled broadcast's audience (tier/subjects) can
    // shift between scheduling and send time, and this always reflects who
    // currently matches.
    const recipients = await this.prisma.user.findMany({
      where: this.broadcastService.buildTargetWhere(
        broadcast.target,
        broadcast.targetValue ?? undefined,
      ),
      select: { phone_number: true },
    });

    let sentCount = 0;
    let failedCount = 0;
    const batchCount = Math.ceil(recipients.length / BATCH_SIZE);

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      for (const recipient of batch) {
        try {
          await this.whatsappSendService.sendText(recipient.phone_number, broadcast.message);
          sentCount++;
        } catch (error) {
          failedCount++;
          this.logger.error(
            `handleBroadcast: failed to send to ${recipient.phone_number}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await sleep(SEND_DELAY_MS);
      }
      this.logger.log(
        `Broadcast ${broadcastId}: batch ${Math.floor(i / BATCH_SIZE) + 1}/${batchCount} complete`,
      );
    }

    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: BroadcastStatus.COMPLETE,
        sentCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    this.logger.log(`Broadcast ${broadcastId} complete: ${sentCount} sent, ${failedCount} failed`);
  }
}
