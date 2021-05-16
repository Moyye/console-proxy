import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (_, callback) => {
      callback(null, true);
    },
    credentials: true,
  });

  await app.listen(22334);
}
bootstrap().then();
