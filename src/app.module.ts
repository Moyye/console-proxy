import { Module } from '@nestjs/common';
import { Provider, Forward } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.prod.env', '.default.env'],
    }),
  ],
  controllers: [AppController],
  providers: [Provider, Forward],
})
export class AppModule {}
