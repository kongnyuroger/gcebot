import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { I18nModule } from '../i18n/i18n.module';
import { PastQuestionService } from './past-question.service';
import { TopicWeaknessService } from './topic-weakness.service';
import { TopicScoreService } from './topic-score.service';
import { PracticeGradingService } from './practice-grading.service';

@Module({
  // RagModule for LlmService (PracticeGradingService's essay/wrong-answer
  // explanations), I18nModule for its MCQ template strings - PrismaService
  // is @Global() so it needs no explicit import.
  imports: [RagModule, I18nModule],
  providers: [PastQuestionService, TopicWeaknessService, TopicScoreService, PracticeGradingService],
  exports: [PastQuestionService, TopicWeaknessService, TopicScoreService, PracticeGradingService],
})
export class PracticeModule {}
