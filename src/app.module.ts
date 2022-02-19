import { Module } from '@nestjs/common';
import { Provider, InnerForward } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.prod.env', '.default.env'],
    }),
  ],
  controllers: [AppController],
  providers: [Provider, InnerForward],
})
export class AppModule {}
