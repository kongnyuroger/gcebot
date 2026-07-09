import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { StateTransitionService } from './state-transition.service';

@Module({
  providers: [SessionService, StateTransitionService],
  exports: [SessionService, StateTransitionService],
})
export class SessionModule {}
