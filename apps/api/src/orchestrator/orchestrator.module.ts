import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { PracticeModule } from '../practice/practice.module';
import { MockModule } from '../mock/mock.module';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';
import { ProgressModule } from '../progress/progress.module';
import { ToolExecutorService } from './tool-executor.service';

@Module({
  imports: [RagModule, PracticeModule, MockModule, UsersModule, SessionModule, ProgressModule],
  providers: [ToolExecutorService],
  exports: [ToolExecutorService],
})
export class OrchestratorModule {}
