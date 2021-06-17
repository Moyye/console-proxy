import { Module } from '@nestjs/common';
import { TerminalController } from './terminal.controller';
import { ForwardController } from './forward.controller';
import { TerminalService } from './terminal.service';
import { ConfigModule } from '@nestjs/config';
import { ForwardService } from './forward.service';

const controllers: any = [TerminalController];
if (process.env.RUNTIME_ENV !== 'OFFICE') {
  controllers.push(ForwardController);
}

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.prod.env', '.default.env'],
    }),
  ],
  controllers: controllers,
  providers: [TerminalService, ForwardService],
})
export class AppModule {}
