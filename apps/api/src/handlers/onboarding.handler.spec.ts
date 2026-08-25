import { ConversationState } from '@gcebot/shared';
import { Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { OnboardingSubjectParserService } from './onboarding-subject-parser.service';
import { MainMenuHandler } from './main-menu.handler';
import { OnboardingHandler } from './onboarding.handler';

describe('OnboardingHandler', () => {
  let handler: OnboardingHandler;
  let sendText: jest.Mock;
  let sendButtons: jest.Mock;
  let sendMenu: jest.Mock;
  let getUserProfile: jest.Mock;
  let updateSubjects: jest.Mock;
  let transition: jest.Mock;
  let parseFreeform: jest.Mock;

  const phone = '237670000011';

  function textReply(text: string): ParsedMessage {
    return { from: phone, messageId: 'msg-1', timestamp: Date.now(), type: 'text', text };
  }

  beforeEach(() => {
    sendText = jest.fn();
    sendButtons = jest.fn();
    sendMenu = jest.fn();
    getUserProfile = jest.fn().mockResolvedValue({ level: Level.O_LEVEL, language: Language.EN });
    updateSubjects = jest.fn();
    transition = jest.fn();
    parseFreeform = jest.fn();

    handler = new OnboardingHandler(
      { getUserProfile, updateSubjects } as unknown as UsersService,
      { getSession: jest.fn(), updateSessionField: jest.fn() } as unknown as SessionService,
      { transition } as unknown as StateTransitionService,
      { sendText, sendButtons } as unknown as WhatsappSendService,
      new I18nService(),
      { parseFreeform } as unknown as OnboardingSubjectParserService,
      { sendMenu } as unknown as MainMenuHandler,
    );
  });

  describe('handleSubjectTextReply', () => {
    it('commits immediately on an unambiguous numbers reply, with no LLM call', async () => {
      await handler.handleSubjectTextReply(textReply('1,3,5'));

      // O_LEVEL order: 1=Biology, 3=Mathematics, 5=English Language
      expect(parseFreeform).not.toHaveBeenCalled();
      expect(updateSubjects).toHaveBeenCalledWith(phone, [
        'Biology',
        'Mathematics',
        'English Language',
      ]);
      expect(transition).toHaveBeenCalledWith(phone, ConversationState.MAIN_MENU);
      expect(sendMenu).toHaveBeenCalled();
    });

    it('commits immediately on an unambiguous exact-name reply, with no LLM call', async () => {
      await handler.handleSubjectTextReply(textReply('biology, Physics'));

      expect(parseFreeform).not.toHaveBeenCalled();
      expect(updateSubjects).toHaveBeenCalledWith(phone, ['Biology', 'Physics']);
    });

    it('falls back to the LLM parser for casual free-form phrasing', async () => {
      parseFreeform.mockResolvedValue({ matched: true, subjects: ['Biology', 'Chemistry'] });

      await handler.handleSubjectTextReply(textReply('doing bio and chem'));

      expect(parseFreeform).toHaveBeenCalledWith(
        'doing bio and chem',
        Level.O_LEVEL,
        Language.EN,
        [],
      );
      expect(updateSubjects).toHaveBeenCalledWith(phone, ['Biology', 'Chemistry']);
      expect(transition).toHaveBeenCalledWith(phone, ConversationState.MAIN_MENU);
    });

    it('falls back to the LLM parser when some tokens are unrecognized', async () => {
      parseFreeform.mockResolvedValue({ matched: true, subjects: ['Biology'] });

      await handler.handleSubjectTextReply(textReply('1, banana, 99'));

      expect(parseFreeform).toHaveBeenCalled();
      expect(updateSubjects).toHaveBeenCalledWith(phone, ['Biology']);
    });

    it("relays the LLM's own clarifying question and stays in SUBJECT_SELECTION when nothing matches", async () => {
      parseFreeform.mockResolvedValue({
        matched: false,
        clarification: 'Could you tell me which subjects you are taking?',
      });

      await handler.handleSubjectTextReply(textReply('what are my options?'));

      expect(sendText).toHaveBeenCalledWith(
        phone,
        'Could you tell me which subjects you are taking?',
      );
      expect(updateSubjects).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the LLM gives no clarification text', async () => {
      parseFreeform.mockResolvedValue({ matched: false, clarification: null });

      await handler.handleSubjectTextReply(textReply('asdkjhasd'));

      expect(sendText).toHaveBeenCalled();
      expect(updateSubjects).not.toHaveBeenCalled();
    });

    it('replies gracefully and does not throw when the LLM parser itself fails', async () => {
      parseFreeform.mockRejectedValue(new Error('OpenAI is down'));

      await expect(
        handler.handleSubjectTextReply(textReply('doing bio and chem')),
      ).resolves.toBeUndefined();

      expect(sendText).toHaveBeenCalled();
      expect(updateSubjects).not.toHaveBeenCalled();
    });

    it('asks again without calling the parser when the message has no text', async () => {
      await handler.handleSubjectTextReply({
        from: phone,
        messageId: 'msg-3',
        timestamp: Date.now(),
        type: 'button_reply',
        buttonId: 'x',
      });

      expect(parseFreeform).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalled();
      expect(updateSubjects).not.toHaveBeenCalled();
    });
  });
});
