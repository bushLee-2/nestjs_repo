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
      fn: this.utilsService.processImage,
      parameters: uploadDto.imageBase64,
      status: JobStatus.PENDING,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const aiAssesmentId: string = uuidv4();
    const aiAssesmentJob = {
      id: aiAssesmentId,
      fn: this.aiService.aiProcessImage,
      // parameters:
      status: JobStatus.PENDING,
      dependsOn: processImgId,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const uploadImageId: string = uuidv4();
    const uploadImageJob = {
      id: uploadImageId,
      fn: this.ipfsService.uploadFile,
      parameters: [],
      status: JobStatus.PENDING,
      dependsOn: [aiAssesmentId, processImgJob],
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const generateMetadataId = uuidv4();
    const generateMetadataJob = {
      id: generateMetadataId,
      fn: this.utilsService.generateMetadata,
      // parameters:
      status: JobStatus.PENDING,
      dependsOn: [uploadImageJob, aiAssesmentId],
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const uploadMetadataId: string = uuidv4();
    const uploadMetadataJob = {
      id: uploadMetadataId,
      fn: this.ipfsService.uploadMetadata,
      // parameters:
      status: JobStatus.PENDING,
      dependsOn: generateMetadataId,
      clientId: uploadDto.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    // 	TODO: add all these to a queue
    const jobs = [
      processImgJob,
      aiAssesmentId,
      uploadImageJob,
      generateMetadataJob,
      uploadMetadataJob,
    ];
  }

  private async processImage(imageBase64: string, hasPhysicalAsset: boolean)  {
      const image = await this.utilsService.processImage(imageBase64)
      const aiResponse  = await this.aiService.aiProcessImage(image, hasPhysicalAsset)
      return {image, aiResponse};
  }

  private async uploadData(uploadDTO: UploadDto, resizedImage: string, aiResponse: any) {
    const ipfsHash = await this.ipfsService.uploadFile(
      Buffer.from(resizedImage, 'base64'), this.utilsService.genRandImgName()
    )
    const metadata = this.utilsService.generateMetadata(
      uploadDTO, aiResponse, ipfsHash
    )
  }
}
