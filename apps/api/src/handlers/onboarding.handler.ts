import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class OnboardingHandler {
  private readonly logger = new Logger(OnboardingHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
  ) {}

  async handleNewUser(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    this.logger.log(`Starting onboarding for new user ${phone}`);

    const user = await this.usersService.upsertUser(phone);

    // No prior session exists for a brand-new user, so there is nothing for
    // StateTransitionService to validate FROM yet - bootstrap it directly.
    await this.sessionService.setSession(phone, { state: ConversationState.ONBOARDING });

    const name = message.contactName ?? 'there';
    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('welcome.greeting', user.language, { name }),
    );

    await this.sendLevelSelection(phone, user.language);

    await this.stateTransitionService.transition(phone, ConversationState.LEVEL_SELECTION);
  }

  private async sendLevelSelection(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(phone, this.i18n.t('onboarding.selectLevel', lang), [
      { id: 'O_LEVEL', title: this.i18n.t('onboarding.levelOLevel', lang) },
      { id: 'A_LEVEL', title: this.i18n.t('onboarding.levelALevel', lang) },
    ]);
  }
}
