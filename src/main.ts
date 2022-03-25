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

  const port = process.env.PORT || 3000;
  console.log('listen PORT', port);
  await app.listen(port);
}
bootstrap().then();

process.setUncaughtExceptionCaptureCallback((error) => {
  console.log(error);
});
