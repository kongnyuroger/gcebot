import { ConversationState } from '@gcebot/shared';
import { Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { MainMenuHandler } from './main-menu.handler';
import { OnboardingHandler } from './onboarding.handler';

describe('OnboardingHandler', () => {
  let handler: OnboardingHandler;
  let sendText: jest.Mock;
  let sendButtons: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let getUserProfile: jest.Mock;
  let updateSubjects: jest.Mock;
  let transition: jest.Mock;

  const phone = '237670000011';

  function textReply(text: string): ParsedMessage {
    return { from: phone, messageId: 'msg-1', timestamp: Date.now(), type: 'text', text };
  }

  function buttonReply(buttonId: string): ParsedMessage {
    return {
      from: phone,
      messageId: 'msg-2',
      timestamp: Date.now(),
      type: 'button_reply',
      buttonId,
    };
  }

  beforeEach(() => {
    sendText = jest.fn();
    sendButtons = jest.fn();
    getSession = jest.fn();
    updateSessionField = jest.fn();
    getUserProfile = jest.fn().mockResolvedValue({ level: Level.O_LEVEL, language: Language.EN });
    updateSubjects = jest.fn();
    transition = jest.fn();

    handler = new OnboardingHandler(
      { getUserProfile, updateSubjects } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { transition } as unknown as StateTransitionService,
      { sendText, sendButtons } as unknown as WhatsappSendService,
      new I18nService(),
      { sendMenu: jest.fn() } as unknown as MainMenuHandler,
    );
  });

  describe('handleSubjectTextReply', () => {
    it('parses several comma-separated numbers into multiple subjects in one reply', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: [],
      });

      await handler.handleSubjectTextReply(textReply('1,3,5'));

      // O_LEVEL order: 1=Biology, 3=Mathematics, 5=English Language
      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', [
        'Biology',
        'Mathematics',
        'English Language',
      ]);
      expect(sendButtons).toHaveBeenCalled();
    });

    it('parses subject names as well as numbers, case-insensitively', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: [],
      });

      await handler.handleSubjectTextReply(textReply('biology, Physics'));

      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', [
        'Biology',
        'Physics',
      ]);
    });

    it('accumulates on top of subjects already picked in an earlier reply', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: ['Biology'],
      });

      await handler.handleSubjectTextReply(textReply('2'));

      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', [
        'Biology',
        'Chemistry',
      ]);
    });

    it('does not duplicate a subject already picked', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: ['Biology'],
      });

      await handler.handleSubjectTextReply(textReply('1'));

      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', ['Biology']);
    });

    it('reports unrecognized tokens without dropping the valid ones', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: [],
      });

      await handler.handleSubjectTextReply(textReply('1, banana, 99'));

      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', ['Biology']);
      const notUnderstoodMessages = sendText.mock.calls.filter(
        (call) => String(call[1]).includes('banana') || String(call[1]).includes('99'),
      );
      expect(notUnderstoodMessages.length).toBeGreaterThan(0);
    });

    it('re-prompts without touching pendingSubjects when nothing in the reply is understood', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: [],
      });

      await handler.handleSubjectTextReply(textReply('what are my options?'));

      expect(updateSessionField).not.toHaveBeenCalled();
      expect(sendButtons).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalled();
    });
  });

  describe('handleSubjectSelection (Confirm/Redo buttons)', () => {
    it('Redo clears pendingSubjects and re-sends the subject prompt', async () => {
      await handler.handleSubjectSelection(buttonReply('redo_subjects'));

      expect(updateSessionField).toHaveBeenCalledWith(phone, 'pendingSubjects', []);
      expect(sendText).toHaveBeenCalled();
    });

    it('Confirm saves all accumulated subjects and moves to MAIN_MENU', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: ['Biology', 'Chemistry'],
      });

      await handler.handleSubjectSelection(buttonReply('confirm_subjects'));

      expect(updateSubjects).toHaveBeenCalledWith(phone, ['Biology', 'Chemistry']);
      expect(transition).toHaveBeenCalledWith(phone, ConversationState.MAIN_MENU);
    });

    it('Confirm with nothing selected re-prompts instead of saving', async () => {
      getSession.mockResolvedValue({
        state: ConversationState.SUBJECT_SELECTION,
        pendingSubjects: [],
      });

      await handler.handleSubjectSelection(buttonReply('confirm_subjects'));

      expect(updateSubjects).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalled();
    });
  });
});
