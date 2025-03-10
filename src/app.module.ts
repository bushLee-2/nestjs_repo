import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IpfsService } from './upload/ipfs.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiService } from './upload/ai.service';
import { MultiversxService } from './upload/mvx.service';
import { UploadController } from './upload/upload.controller';
import { UtilsService } from './upload/utils.service';
import { QueueService } from './upload/queue.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      // isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [AppController, UploadController],
  providers: [
    AppService,
    IpfsService,
    AiService,
    UtilsService,
    QueueService,
    MultiversxService,
  ],
})
export class AppModule {}
