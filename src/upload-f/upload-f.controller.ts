import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { UploadDto } from './dto/uploadDto';
import { Job, JobStatus } from './interfaces/job.interface';
import { v4 as uuidv4 } from 'uuid';
import { AiService } from './ai.service';
import { IpfsService } from './ipfs.service';

@Controller('upload')
export class UploadFController {
  constructor(
    private readonly aiService: AiService,
    private readonly ipfsService: IpfsService,
    private readonly utilsService: UtilsService,
  ) {}

  @Post()
  async upload(@Body() uploadDto: UploadDto) {
    const processImgId = uuidv4();
    const processImgJob: Job = {
      id: processImgId,
      fn: this.processImage,
      parameters: [uploadDto.imageBase64, uploadDto.hasPhysicalAsset],
      status: JobStatus.PENDING,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const uploadDataId = uuidv4();
    const uploadData: Job = {
      id: uploadDataId,
      fn: this.uploadData,
      parameters: uploadDto,
      dependsOn: processImgId,
      status: JobStatus.PENDING,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;
    // 	TODO: add all these to a queue
    const jobs = [processImgJob];
  }

  private async processImage(imageBase64: string, hasPhysicalAsset: boolean) {
    const image = await this.utilsService.processImage(imageBase64);
    const aiResponse = await this.aiService.aiProcessImage(
      image,
      hasPhysicalAsset,
    );
    return { image, aiResponse };
  }

  private async uploadData(
    uploadDTO: UploadDto,
    resizedImage: string,
    aiResponse: any,
  ) {
    const ipfsHash = await this.ipfsService.uploadFile(
      Buffer.from(resizedImage, 'base64'),
      this.utilsService.genRandImgName(),
    );
    const metadata = this.utilsService.generateMetadata(
      uploadDTO,
      aiResponse,
      ipfsHash,
    );
  }
}
