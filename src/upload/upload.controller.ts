import { Controller, Post, Body } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { UploadDto } from './dto/uploadDto';
import { Job, JobStatus } from './interfaces/job.interface';
import { v4 as uuidv4 } from 'uuid';
import { AiService } from './ai.service';
import { IpfsService } from './ipfs.service';
import { JobService } from './queue.service';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly aiService: AiService,
    private readonly ipfsService: IpfsService,
    private readonly utilsService: UtilsService,
    private readonly jobService: JobService,
  ) {}

  // region Upload
  @Post()
  async upload(@Body() uploadDto: UploadDto) {
    const processImgId = uuidv4();
    const processImgJob: Job = {
      id: processImgId,
      fn: this.processImage.bind(this),
      parameters: [uploadDto.imageBase64, uploadDto.hasPhysicalAsset],
      dependsOn: [],
      status: JobStatus.PENDING,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const uploadDataId = uuidv4();
    const uploadDataJob: Job = {
      id: uploadDataId,
      fn: this.uploadData.bind(this),
      parameters: [uploadDto],
      dependsOn: [processImgId],
      status: JobStatus.PENDING,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    // 	TODO: add all these to a queue
    const jobs = [processImgJob, uploadDataJob];
    for (const job of jobs) {
      this.jobService.enqueueJob(job);
    }
  }

  private async processImage(imageBase64: string, hasPhysicalAsset: boolean) {
    const resizedImage = await this.utilsService.processImage(imageBase64);
    const aiResponse = await this.aiService.aiProcessImage(
      resizedImage,
      hasPhysicalAsset,
    );
    return { image: imageBase64, aiResponse };
  }

  private async uploadData(
    uploadDTO: UploadDto,
    processedResult: { image: string; aiResponse: any },
  ) {
    // Fixed to correctly receive the result from processImage
    const { image: image, aiResponse } = processedResult;
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }
    const imgName = this.utilsService.genRandImgName();
    const format = matches[1];

    const imageHash = await this.ipfsService.uploadFile(
      Buffer.from(base64Data, 'base64'),
      `${imgName}.${format}`,
    );

    const metadata = this.utilsService.generateMetadata(
      uploadDTO,
      aiResponse,
      imageHash,
    );

    const metadataHash = await this.ipfsService.uploadMetadata(metadata);
    return {
      metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
      imageUrl: this.ipfsService.getIpfsUrl(imageHash),
    };
  }
  //   endregion

  //   region ReassesImage
  //   endregion
}
