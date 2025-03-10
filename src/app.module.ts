import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { IpfsService } from './upload/ipfs.service';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './upload/ai.service';
import { MultiversxService } from './upload/mvx.service';
import { UploadV2Controller } from './upload-v2/upload-v2.controller';
import { UplodFController } from './uplod-f/uplod-f.controller';
import { UploadFController } from './upload-f/upload-f.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    AppController,
    UploadController,
    UploadV2Controller,
    UplodFController,
    UploadFController,
  ],
  providers: [AppService, IpfsService, AiService, MultiversxService],
})
export class AppModule {}
