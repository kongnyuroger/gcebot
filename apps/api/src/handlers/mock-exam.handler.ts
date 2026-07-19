import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationState, SessionContext, MockExamQuestion } from '@gcebot/shared';
import { Language, Level, SubscriptionTier } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { MockPaperService } from '../mock/mock-paper.service';
import { MockTimerService } from '../mock/mock-timer.service';
import { MockGradingService } from '../mock/mock-grading.service';
import { MockReportService } from '../mock/mock-report.service';
import { QUESTION_PREFIX_PATTERN } from '../practice/mcq-grading.util';
import { MainMenuHandler } from './main-menu.handler';

const MAX_SUBJECT_BUTTONS = 3;

export const MOCK_START_EXAM = 'mock_start_exam';
export const MOCK_CANCEL_EXAM = 'mock_cancel_exam';

const PREMIUM_TIERS: SubscriptionTier[] = [SubscriptionTier.PREMIUM, SubscriptionTier.FAMILY];

@Injectable()
export class MockExamHandler {
  private readonly logger = new Logger(MockExamHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly mockPaperService: MockPaperService,
    private readonly mockTimerService: MockTimerService,
    private readonly mockGradingService: MockGradingService,
    private readonly mockReportService: MockReportService,
    // MainMenuHandler already depends on MockExamHandler (to enter
    // MOCK_EXAM_SETUP from the main menu tap) - forwardRef breaks the
    // resulting circular DI edge, same pattern as QA/Practice mode.
    @Inject(forwardRef(() => MainMenuHandler))
    private readonly mainMenuHandler: MainMenuHandler,
  ) {}

  // Reachable both from a MAIN_MENU button tap and the global /mock command
  // (wired in a later step) - resets the session directly into
  // MOCK_EXAM_SETUP, the same escape-hatch pattern as the other modes.
  async enterMockExam(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (!user) {
      this.logger.warn(`enterMockExam: no user profile found for ${phone}`);
      return;
    }

    if (!PREMIUM_TIERS.includes(user.tier)) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('mock.premiumRequired', lang));
      return;
    }

    await this.sessionService.setSession(phone, {
      state: ConversationState.MOCK_EXAM_SETUP,
      mockExam: {},
    });

    if (user.subjects.length === 0) {
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('mock.noSubjectsRegistered', lang),
      );
      return;
    }

    if (user.subjects.length === 1) {
      await this.assembleAndPromptReady(phone, user.subjects[0], user.level, lang);
      return;
    }

    await this.sendSubjectPrompt(phone, user.subjects, lang);
  }

  async handleSetupSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedId = message.buttonId ?? message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (selectedId === MOCK_START_EXAM) {
      await this.startExam(phone, session, lang);
      return;
    }

    if (selectedId === MOCK_CANCEL_EXAM) {
      // Assembly already created the MockExam DB row by this point (it runs
      // right after subject selection, so the real duration can be shown
      // here) - discard it so a cancelled-before-it-started attempt doesn't
      // pollute exam history/reporting.
      if (session?.examId) {
        await this.mockPaperService.discardExam(session.examId);
      }
      await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
      await this.sessionService.updateSessionField(phone, 'mockExam', undefined);
      await this.sessionService.updateSessionField(phone, 'examId', undefined);
      await this.whatsappSendService.sendText(phone, this.i18n.t('mock.cancelled', lang));
      return this.mainMenuHandler.sendMenu(phone);
    }

    if (selectedId && user && user.subjects.includes(selectedId)) {
      await this.assembleAndPromptReady(phone, selectedId, user.level, lang);
      return;
    }

    this.logger.warn(`Unrecognized mock exam setup selection "${selectedId}" from ${phone}`);
    if (session?.mockExam?.subject && session.mockExam.durationMinutes !== undefined) {
      await this.sendReadyPrompt(
        phone,
        session.mockExam.subject,
        session.mockExam.durationMinutes,
        lang,
      );
      return;
    }
    await this.sendSubjectPrompt(phone, user?.subjects ?? [], lang);
  }

  private async startExam(
    phone: string,
    session: SessionContext | null,
    lang: Language,
  ): Promise<void> {
    const examId = session?.examId;
    const durationMinutes = session?.mockExam?.durationMinutes;

    if (!examId || durationMinutes === undefined) {
      this.logger.warn(`startExam: missing examId/durationMinutes in session for ${phone}`);
      return;
    }

    const endTime = Date.now() + durationMinutes * 60_000;
    const timerJobIds = await this.mockTimerService.scheduleTimers(phone, examId, endTime);

    const questions = session?.mockExam?.questions ?? [];

    await this.sessionService.updateSessionField(phone, 'mockExam', {
      ...session?.mockExam,
      endTime,
      timerJobIds,
    });

    await this.stateTransitionService.transition(phone, ConversationState.MOCK_EXAM_ACTIVE);
    await this.deliverQuestion(phone, questions, 0, lang);
  }

  // Free text while MOCK_EXAM_ACTIVE - the student's answer to the current
  // question. Not yet reachable from a real message (routing lands in a
  // later step of this branch), but fully functional when called directly.
  async handleAnswer(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const answerText = message.text?.trim();

    if (!answerText) {
      this.logger.warn(`Non-text message from ${phone} while MOCK_EXAM_ACTIVE; ignoring`);
      return;
    }

    const session = await this.sessionService.getSession(phone);
    if (!this.hasActiveExam(session)) {
      this.logger.warn(`handleAnswer: no active mock exam in session for ${phone}`);
      return;
    }

    await this.recordAnswerAndAdvance(phone, session!, answerText);
  }

  // /skip - records a null answer for the current question and advances,
  // exactly like a real answer except with nothing to grade. Not yet wired
  // to a real /skip command (routing lands in a later step of this branch).
  async handleSkip(phone: string): Promise<void> {
    const session = await this.sessionService.getSession(phone);
    if (!this.hasActiveExam(session)) {
      this.logger.warn(`handleSkip: no active mock exam in session for ${phone}`);
      return;
    }

    await this.recordAnswerAndAdvance(phone, session!, null);
  }

  // /submit (early, at any point) - shares the exact same finish-up logic as
  // both "last question just answered" and the timer's AUTO_SUBMIT job, so
  // there's exactly one place that cancels timers, transitions state, and
  // sends the (for now, stubbed) submission confirmation. Not yet wired to a
  // real /submit command (routing lands in a later step of this branch), but
  // the AUTO_SUBMIT timer job already calls this directly (see
  // MockExamTimerProcessor).
  async submitExam(phone: string): Promise<void> {
    const session = await this.sessionService.getSession(phone);

    if (session?.state !== ConversationState.MOCK_EXAM_ACTIVE) {
      // Already submitted via another path (e.g. the student hit /submit at
      // almost exactly the moment AUTO_SUBMIT's job fired) - nothing to do.
      this.logger.log(
        `submitExam: exam for ${phone} is not active (state=${session?.state}); skipping`,
      );
      return;
    }

    const timerJobIds = session.mockExam?.timerJobIds ?? [];
    if (timerJobIds.length > 0) {
      await this.mockTimerService.cancelTimers(timerJobIds);
    }

    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.stateTransitionService.transition(phone, ConversationState.MOCK_EXAM_REPORT);
    await this.whatsappSendService.sendText(phone, this.i18n.t('mock.submitted', lang));

    if (session.examId) {
      try {
        await this.mockGradingService.gradeExam(phone, session.examId);
      } catch (error) {
        // Grading failure shouldn't strand the student mid-flow - they still
        // get a submission confirmation, and generateReport() below handles
        // a MockExam row with no score gracefully (reportUngraded fallback).
        this.logger.error(
          `submitExam: grading failed for ${phone} (examId=${session.examId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const reportParts = await this.mockReportService.generateReport(session.examId);
      for (const part of reportParts) {
        await this.whatsappSendService.sendText(phone, part);
      }
    } else {
      this.logger.warn(`submitExam: no examId in session for ${phone}; skipping grading/report`);
    }

    await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
    await this.sessionService.updateSessionField(phone, 'mockExam', undefined);
    await this.sessionService.updateSessionField(phone, 'examId', undefined);
    await this.mainMenuHandler.sendMenu(phone);
  }

  private hasActiveExam(session: SessionContext | null): boolean {
    return (
      !!session?.mockExam?.questions &&
      session.mockExam.questions.length > 0 &&
      session.mockExam.currentIndex !== undefined
    );
  }

  private async recordAnswerAndAdvance(
    phone: string,
    session: SessionContext,
    answer: string | null,
  ): Promise<void> {
    const mockExam = session.mockExam!;
    const questions = mockExam.questions!;
    const currentIndex = mockExam.currentIndex!;
    const answers = [...(mockExam.answers ?? [])];
    answers[currentIndex] = answer;

    const nextIndex = currentIndex + 1;
    await this.sessionService.updateSessionField(phone, 'mockExam', {
      ...mockExam,
      answers,
      currentIndex: nextIndex,
    });

    if (nextIndex < questions.length) {
      const user = await this.usersService.getUserProfile(phone);
      const lang = user?.language ?? Language.EN;
      await this.deliverQuestion(phone, questions, nextIndex, lang);
      return;
    }

    // Last question just answered/skipped - trigger submit early.
    await this.submitExam(phone);
  }

  private async deliverQuestion(
    phone: string,
    questions: MockExamQuestion[],
    index: number,
    lang: Language,
  ): Promise<void> {
    const question = questions[index];
    const body = question.questionText.replace(QUESTION_PREFIX_PATTERN, '').trim();

    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('mock.questionDelivery', lang, {
        current: String(index + 1),
        total: String(questions.length),
        questionText: body,
      }),
    );
  }

  private async assembleAndPromptReady(
    phone: string,
    subject: string,
    level: Level,
    lang: Language,
  ): Promise<void> {
    let paper;
    try {
      paper = await this.mockPaperService.assemblePaper(phone, subject, level);
    } catch (error) {
      this.logger.warn(
        `Could not assemble a mock exam paper for ${phone} (${subject}, ${level}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
      await this.sessionService.updateSessionField(phone, 'mockExam', undefined);
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('mock.noContentAvailable', lang, { subject }),
      );
      return this.mainMenuHandler.sendMenu(phone);
    }

    await this.sessionService.updateSessionField(phone, 'examId', paper.examId);
    await this.sessionService.updateSessionField(phone, 'mockExam', {
      subject,
      paperType: paper.paperType,
      durationMinutes: paper.durationMinutes,
      questions: paper.questions,
      currentIndex: 0,
      answers: [],
    });

    await this.sendReadyPrompt(phone, subject, paper.durationMinutes, lang);
  }

  private async sendSubjectPrompt(
    phone: string,
    subjects: string[],
    lang: Language,
  ): Promise<void> {
    const promptText = this.i18n.t('mock.selectSubject', lang);

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
      this.i18n.t('mock.selectSubjectListButton', lang),
      [
        {
          title: this.i18n.t('mock.selectSubjectSectionTitle', lang),
          rows: subjects.map((subject) => ({ id: subject, title: subject })),
        },
      ],
    );
  }

  private async sendReadyPrompt(
    phone: string,
    subject: string,
    durationMinutes: number,
    lang: Language,
  ): Promise<void> {
    await this.whatsappSendService.sendButtons(
      phone,
      this.i18n.t('mock.readyPrompt', lang, { subject, duration: String(durationMinutes) }),
      [
        { id: MOCK_START_EXAM, title: this.i18n.t('mock.startExam', lang) },
        { id: MOCK_CANCEL_EXAM, title: this.i18n.t('mock.cancelExam', lang) },
      ],
    );
  }
}
