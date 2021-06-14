import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { TerminalService } from './terminal.service';
import { ConfigModule } from '@nestjs/config';
import { ForwardService } from './forward.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.prod.env', '.default.env'],
    }),
  ],
  controllers: [AppController],
  providers: [TerminalService, ForwardService],
})
export class AppModule {}
