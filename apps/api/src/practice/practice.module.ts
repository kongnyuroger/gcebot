import { Module } from '@nestjs/common';
import { PastQuestionService } from './past-question.service';
import { TopicWeaknessService } from './topic-weakness.service';
import { TopicScoreService } from './topic-score.service';

@Module({
  providers: [PastQuestionService, TopicWeaknessService, TopicScoreService],
  exports: [PastQuestionService, TopicWeaknessService, TopicScoreService],
})
export class PracticeModule {}
