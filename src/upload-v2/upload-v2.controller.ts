import { Body, Controller, Post } from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { AiService } from './ai.service';
import { MultiversxService } from './mvx.service';
import { UtilsService } from './utils.service';
import { UploadDto } from './dto/upload.dto';

@Controller('upload-v2')
export class UploadV2Controller {
  constructor(
    private readonly ipfsService: IpfsService,
    private readonly aiService: AiService,
    private readonly mvxService: MultiversxService,
    private readonly utilsService: UtilsService,
  ) {}

  @Post('')
  async uploadToIpfs(@Body() uploadDto: UploadDto): Promise<IpfsUploadResult> {}
}
