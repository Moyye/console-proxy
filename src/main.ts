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

  console.log('listen PORT', process.env.PORT);
  await app.listen(22334);
}
bootstrap().then();

process.setUncaughtExceptionCaptureCallback((error) => {
  console.log(error);
});
