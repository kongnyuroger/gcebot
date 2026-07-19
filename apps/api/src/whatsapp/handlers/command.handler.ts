import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language } from '../../../generated/prisma';
import { ParsedMessage } from '../services/message-parser.service';
import { WhatsappSendService } from '../services/whatsapp-send.service';
import { SessionService } from '../../session/session.service';
import { UsersService } from '../../users/users.service';
import { I18nService } from '../../i18n/i18n.service';
import { OnboardingHandler } from '../../handlers/onboarding.handler';
import { QaModeHandler } from '../../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../../handlers/practice-mode.handler';

@Injectable()
export class CommandHandler {
  private readonly logger = new Logger(CommandHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly onboardingHandler: OnboardingHandler,
    private readonly qaModeHandler: QaModeHandler,
    private readonly practiceModeHandler: PracticeModeHandler,
  ) {}

  async handle(message: ParsedMessage, commandName: string): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    this.logger.log(`COMMAND from ${phone}: /${commandName}`);

    switch (commandName) {
      case 'settings':
        return this.handleSettings(phone, lang);
      case 'en':
        return this.handleLanguageSwitch(phone, Language.EN);
      case 'fr':
        return this.handleLanguageSwitch(phone, Language.FR);
      case 'help':
        return this.handleHelp(phone, lang);
      case 'ask':
        return this.qaModeHandler.enterQaMode(phone);
      case 'hint':
        return this.qaModeHandler.handleHint(message);
      case 'practice':
        return this.practiceModeHandler.enterPracticeMode(phone);
      default:
        this.logger.warn(`Unknown command "/${commandName}" from ${phone}`);
        return this.handleUnknownCommand(phone, lang);
    }
  }

  private async handleSettings(phone: string, lang: Language): Promise<void> {
    // /settings is a deliberate reset back to LEVEL_SELECTION from wherever the
    // user currently is - VALID_TRANSITIONS only allows ONBOARDING -> LEVEL_SELECTION,
    // so this bypasses StateTransitionService and writes the session directly.
    await this.sessionService.updateSessionField(phone, 'state', ConversationState.LEVEL_SELECTION);
    await this.sessionService.updateSessionField(phone, 'pendingSubjects', []);

    await this.whatsappSendService.sendText(phone, this.i18n.t('settings.resetting', lang));
    await this.onboardingHandler.sendLevelSelection(phone, lang);
  }

  private async handleLanguageSwitch(phone: string, language: Language): Promise<void> {
    await this.usersService.updateLanguage(phone, language);
    // Confirmation is sent in the NEW language, not whatever it was before.
    await this.whatsappSendService.sendText(phone, this.i18n.t('language.switched', language));
  }

  private async handleHelp(phone: string, lang: Language): Promise<void> {
    const message = `${this.i18n.t('help.title', lang)}\n${this.i18n.t('help.commandList', lang)}`;
    await this.whatsappSendService.sendText(phone, message);
  }

  private async handleUnknownCommand(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendText(phone, this.i18n.t('errors.unknownCommand', lang));
  }
}
