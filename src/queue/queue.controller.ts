import { Body, Controller, Post } from '@nestjs/common';
import { IpfsService } from '../upload-v2/ipfs.service';
import { AiService } from '../upload-v2/ai.service';
import { MultiversxService } from '../upload-v2/mvx.service';
import { UtilsService } from '../upload-v2/utils.service';
import { UploadDto } from '../upload/dto/upload.dto';

@Controller('queue')
export class QueueController {
  constructor(
    private readonly ipfsService: IpfsService,
    private readonly aiService: AiService,
    private readonly mvxService: MultiversxService,
    private readonly utilsService: UtilsService,
  ) {}

  @Post('')
  async uploadToIpfs(@Body() uploadDto: UploadDto): Promise<IpfsUploadResult> {}
}
