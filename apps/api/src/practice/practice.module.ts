import { Module } from '@nestjs/common';
import { PastQuestionService } from './past-question.service';

@Module({
  providers: [PastQuestionService],
  exports: [PastQuestionService],
})
export class PracticeModule {}
