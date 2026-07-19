import { Module } from '@nestjs/common';
import { PastQuestionService } from './past-question.service';
import { TopicWeaknessService } from './topic-weakness.service';

@Module({
  providers: [PastQuestionService, TopicWeaknessService],
  exports: [PastQuestionService, TopicWeaknessService],
})
export class PracticeModule {}
