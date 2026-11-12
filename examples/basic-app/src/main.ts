import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  const storage = process.env.REDIS_URL ? 'Redis' : 'in-memory';
  console.log(`basic-app listening on http://localhost:${port} (${storage} storage)`);
}

void bootstrap();
