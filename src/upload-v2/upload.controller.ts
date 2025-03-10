import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService, Job } from './queue.service';
// import { IpfsService } from './ipfs.service';
// import { MultiversxService } from './mvx.service';

import { UploadDto } from './dto/upload.dto';
// import { AiService } from './ai.service';
import { ReassesDTO } from './dto/reasses.dto';
import { UtilsService } from './utils.service';

@Controller('upload')
export class UploadController {
  constructor(
    // private readonly ipfsService: IpfsService,
    // private readonly aiService: AiService,
    // private readonly mvxService: MultiversxService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  private readonly utilsService: UtilsService,
  ) {}

  @Post('')
  async ipfsUpload(@Body() uploadDto: UploadDto): Promise<any> {
	  const imageProcess = {
		  id: uploadDto.clientId,
		  status: 'pending',
		  createdAt: new Date(),
		  updatedAt: new Date(),
		  fn: this.utilsService.

	  }
	  this.queueService.addJob(
	  )
	  this.queueService.addJob()
  }

  @Post('reassess')
  async reassesAndUpload(@Body() uploadDto: UploadDto): Promise<any> {}
}
