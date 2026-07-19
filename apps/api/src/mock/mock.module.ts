import { Module } from '@nestjs/common';
import { PracticeModule } from '../practice/practice.module';
import { MockPaperService } from './mock-paper.service';

@Module({
  imports: [PracticeModule],
  providers: [MockPaperService],
  exports: [MockPaperService],
})
export class MockModule {}
