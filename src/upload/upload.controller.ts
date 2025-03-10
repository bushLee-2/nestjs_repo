import { Controller, Post, Body } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { UploadDto } from './dto/uploadDto';
import { Job, JobStatus } from './interfaces/job.interface';
import { v4 as uuidv4 } from 'uuid';
import { AiService } from './ai.service';
import { IpfsService } from './ipfs.service';
import { QueueService } from './queue.service';
import { ReassesDTO } from './dto/reasses.dto';
import { Metadata } from './interfaces/metadata.interfaces';
import { MultiversxService } from './mvx.service';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly aiService: AiService,
    private readonly ipfsService: IpfsService,
    private readonly utilsService: UtilsService,
    private readonly jobService: QueueService,
    private readonly mvxService: MultiversxService,
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
    // TODO: try catch for errors
    const resizedImage = await this.utilsService.processImage(imageBase64);
    const aiResponse = await this.aiService.aiProcessImage(
      resizedImage,
      hasPhysicalAsset,
    );
    return { image: imageBase64, aiResponse };
  }

  private async uploadData(
    uploadDTO: UploadDto,
    processImage: { image: string; aiResponse: any },
  ) {
    // TODO: try catch for errors
    const { image: image, aiResponse } = processImage;
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

  // region ReassessImage
  @Post('reassess')
  async reassessAndUpload(@Body() reassessDTO: ReassesDTO) {
    const processImgsId = uuidv4();
    const processImgJob = {
      id: processImgsId,
      fn: this.processImages.bind(this),
      parameters: [reassessDTO.imageBase64, reassessDTO.tokenIdentifier],
      dependsOn: [],
      status: JobStatus.PENDING,
      clientId: reassessDTO.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const reassessImgsId = uuidv4();
    const reassessImgJob = {
      id: reassessImgsId,
      fn: this.reassessImages.bind(this),
      parameters: [],
      dependsOn: [processImgsId],
      status: JobStatus.PENDING,
      clientId: reassessDTO.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const uploadReassessId = uuidv4();
    const uploadReassessJob = {
      id: uploadReassessId,
      fn: this.uploadReassessed.bind(this),
      parameters: [reassessDTO.imageBase64, reassessDTO.tokenIdentifier],
      dependsOn: [reassessImgsId, processImgsId],
      status: JobStatus.PENDING,
      clientId: reassessDTO.clientID,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Job;

    const jobs = [processImgJob, reassessImgJob, uploadReassessJob];
    for (const job of jobs) {
      this.jobService.enqueueJob(job);
    }
  }

  private async processImages(imageBase64: string, oldImageIdentifier: string) {
    let oldMetadata;
    let originalUrl;
    let oldImageBase64;
    let imgResizedBase64;
    let resizedOldImage;
    let rawNFT;

    // region Process old image
    try {
      const nftData = await this.utilsService.fetchNftData(oldImageIdentifier);
      oldMetadata = nftData.oldMetadata;
      originalUrl = nftData.originalUrl;
      rawNFT = nftData.rawNft;
      oldImageBase64 = await this.utilsService.fetchImageAsBase64(originalUrl);
    } catch (error) {
      throw new Error(`Error while getting old image data: ${error}`);
    }
    // endregion

    // region Resize Images
    try {
      imgResizedBase64 = await this.utilsService.processImage(imageBase64);
      resizedOldImage = await this.utilsService.processImage(oldImageBase64);
      await this.utilsService.processImage(oldImageBase64);
    } catch (error) {
      throw new Error(`Error resizing images: ${error}`);
    }

    // endregion

    return {
      img: imgResizedBase64,
      oldImageResized: resizedOldImage,
      oldMetadata: oldMetadata,
      rawNFT: rawNFT,
    };
  }

  private async reassessImages(processImages: {
    img: string;
    oldImageResized: string;
    oldMetadata: string;
  }) {
    const {
      img: img,
      oldMetadata: oldMetadata,
      oldImageResized: oldImage,
    } = processImages;
    let aiReassessment: string;
    let unixTimestamp: number;

    try {
      unixTimestamp = Math.floor(Date.now() / 1000);
      aiReassessment = await this.aiService.aiReassesImage(
        img,
        oldMetadata,
        oldImage,
        unixTimestamp,
      );
    } catch (error) {
      throw new Error(`Error reassessing images: ${error}`);
    }

    return {
      aiReassessment,
      unixTimestamp,
    };
  }

  private async uploadReassessed(
    imageBase64: string,
    tokenIdentifier: string,
    reassessImages: {
      aiReassessment: string;
      unixTimestamp: number;
    },
    processImage: {
      oldMetadata: Metadata;
      rawNFT: string;
    },
  ) {
    // TODO: try catch for errors
    const { aiReassessment, unixTimestamp } = reassessImages;
    const { oldMetadata, rawNFT } = processImage;

    // region Upload new image
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }

    const imgName = this.utilsService.genRandImgName();
    const format = matches[1];

    const imageHash = await this.ipfsService.uploadFile(
      Buffer.from(base64Data, 'base64'),
      `${imgName}.${format}`,
    );
    //   endregion

    // region Upload new metadata
    const aiResponseObj = JSON.parse(aiReassessment);
    const reassessAttributes = this.utilsService.recurseParseObj(
      aiResponseObj,
      [],
      [],
      'xArtistsAI',
    );
    oldMetadata.attributes = [
      ...oldMetadata.attributes,
      ...reassessAttributes,
      {
        trait_type: `xArtistsAI_assessment_${unixTimestamp}_image_url`,
        value: this.ipfsService.getIpfsUrl(aiResponseObj.image),
      },
    ];

    const metadataHash = await this.ipfsService.uploadMetadata(oldMetadata);
    // endregion

    await this.mvxService.updateInternalAccount();
    const ok = await this.mvxService.sendUpdateTx(
      tokenIdentifier,
      this.ipfsService.getIpfsUrl(metadataHash),
      rawNFT,
    );
    if (!ok) {
      throw new Error('Mx service failed to update NFT');
    }
    return {
      metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
      imageUrl: this.ipfsService.getIpfsUrl(imageHash),
    };
  }
  //   endregion
}
