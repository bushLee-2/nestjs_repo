import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload/upload.controller';
import { IpfsService } from './upload/ipfs.service';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './upload/ai.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, UploadController],
  providers: [AppService, IpfsService, AiService],
})
export class AppModule {}
