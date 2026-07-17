import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language } from '../../generated/prisma';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';

const MAX_SUBJECT_BUTTONS = 3;

@Injectable()
export class QaModeHandler {
  private readonly logger = new Logger(QaModeHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
  ) {}

  // Reachable both from a MAIN_MENU button tap (a valid graph edge) and from
  // the global /ask command, which - like /menu and /settings - must work
  // from any state. Rather than branch on the caller, this always resets the
  // session straight into QA_MODE directly (bypassing StateTransitionService),
  // the same escape-hatch pattern CommandHandler already uses.
  async enterQaMode(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.sessionService.setSession(phone, {
      state: ConversationState.QA_MODE,
      subject: undefined,
      conversationHistory: [],
      currentQuestionText: undefined,
    });

    if (!user) {
      this.logger.warn(`enterQaMode: no user profile found for ${phone}`);
      return;
    }

    if (user.subjects.length === 0) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('qa.noSubjectsRegistered', lang));
      return;
    }

    await this.sendSubjectPrompt(phone, user.subjects, lang);
  }

  private async sendSubjectPrompt(
    phone: string,
    subjects: string[],
    lang: Language,
  ): Promise<void> {
    const promptText = this.i18n.t('qa.selectSubject', lang);

    if (subjects.length <= MAX_SUBJECT_BUTTONS) {
      await this.whatsappSendService.sendButtons(
        phone,
        promptText,
        subjects.map((subject) => ({ id: subject, title: subject })),
      );
      return;
    }

    await this.whatsappSendService.sendList(
      phone,
      promptText,
      this.i18n.t('qa.selectSubjectListButton', lang),
      [
        {
          title: this.i18n.t('qa.selectSubjectSectionTitle', lang),
          rows: subjects.map((subject) => ({ id: subject, title: subject })),
        },
      ],
    );
  }
}
