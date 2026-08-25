import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { parseSubjectSelections, SUBJECTS_BY_LEVEL } from './subjects.constants';
import { OnboardingSubjectParserService } from './onboarding-subject-parser.service';
import { MainMenuHandler } from './main-menu.handler';

@Injectable()
export class OnboardingHandler {
  private readonly logger = new Logger(OnboardingHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly subjectParser: OnboardingSubjectParserService,
    private readonly mainMenuHandler: MainMenuHandler,
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

  async handleLevelSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const buttonId = message.buttonId;

    if (buttonId !== Level.O_LEVEL && buttonId !== Level.A_LEVEL) {
      this.logger.warn(`Unexpected level selection buttonId "${buttonId}" from ${phone}`);
      const user = await this.usersService.getUserProfile(phone);
      return this.sendLevelSelection(phone, user?.language ?? Language.EN);
    }

    const user = await this.usersService.updateLevel(phone, buttonId);

    await this.sendSubjectPrompt(phone, buttonId, user.language);

    await this.stateTransitionService.transition(phone, ConversationState.SUBJECT_SELECTION);
  }

  // Replies with subjects conversationally now - "Biology, Chemistry, and
  // Add Maths" works in one message, no numbered list or Confirm/Redo button
  // round-trip required. An exact numbers/names reply (parseSubjectSelections)
  // is resolved instantly with no LLM call; anything looser is handed to
  // OnboardingSubjectParserService. Either way, the first confidently-parsed
  // reply commits immediately and moves on to MAIN_MENU - if the model or
  // student got something wrong, fixing it afterward is a normal
  // conversation with the orchestrator's update_profile tool, not a second
  // onboarding round-trip.
  async handleSubjectTextReply(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const level = user?.level ?? Level.O_LEVEL;

    if (!message.text) {
      this.logger.warn(`Subject-selection free-text reply from ${phone} had no text`);
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('onboarding.noSubjectsUnderstood', lang),
      );
      return;
    }

    const { matched, unmatched } = parseSubjectSelections(message.text, SUBJECTS_BY_LEVEL[level]);

    let subjects: string[];
    if (matched.length > 0 && unmatched.length === 0) {
      // Every token was a clean number/exact-name match - no ambiguity, so
      // there's nothing for an LLM call to add here.
      subjects = matched;
    } else {
      let result;
      try {
        result = await this.subjectParser.parseFreeform(message.text, level, lang, []);
      } catch (error) {
        this.logger.error(
          `Onboarding subject parsing failed for ${phone}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.whatsappSendService.sendText(
          phone,
          this.i18n.t('onboarding.noSubjectsUnderstood', lang),
        );
        return;
      }

      if (!result.matched) {
        await this.whatsappSendService.sendText(
          phone,
          result.clarification ?? this.i18n.t('onboarding.noSubjectsUnderstood', lang),
        );
        return;
      }
      subjects = result.subjects;
    }

    await this.usersService.updateSubjects(phone, subjects);
    await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);

    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('onboarding.subjectsSaved', lang, { subjects: subjects.join(', ') }),
    );
    await this.mainMenuHandler.sendMenu(phone);
  }

  // Public: reused by CommandHandler's /settings command to re-run this same step.
  async sendLevelSelection(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(phone, this.i18n.t('onboarding.selectLevel', lang), [
      { id: Level.O_LEVEL, title: this.i18n.t('onboarding.levelOLevel', lang) },
      { id: Level.A_LEVEL, title: this.i18n.t('onboarding.levelALevel', lang) },
    ]);
  }

  private async sendSubjectPrompt(phone: string, level: Level, lang: Language): Promise<void> {
    const subjectList = SUBJECTS_BY_LEVEL[level].map((subject) => subject.name).join(', ');

    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('onboarding.selectSubjectsPrompt', lang, { subjectList }),
    );
  }
}
