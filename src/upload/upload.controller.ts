// First, ensure IpfsService is exported with @Injectable()
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsService } from './ipfs.service';
import { UploadDto } from './dto/create-upload.dto';
import { AiService } from './ai.service';


interface IpfsUploadResult {
  directoryHash: string;
  directoryUrl: string;
  metadataUrl: string;
  imageUrl: string;
}

@Controller('upload')
export class UploadController {
  constructor(
    private readonly ipfsService: IpfsService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService
  ) {}

  @Post('')
  async uploadToIpfs(@Body() uploadDto: UploadDto): Promise<IpfsUploadResult> {
    try {
      const base64Data = uploadDto.image.replace(/^data:image\/\w+;base64,/, '');
      
      let imageFormat = 'png';
      const formatMatch = uploadDto.image.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      const resizedImageBuffer = await this.aiService.resizeBase64Image(uploadDto.image) 
      // const aiResponse = await this.aiService.aiProcessImage(resizedImageBuffer);

      
      const metadata = {
        title: uploadDto.title,
        description: uploadDto.description,
        timestamp: new Date().toISOString(),
      };
      
      const imageName = `image.${imageFormat}`;
      const imageHash = await this.ipfsService.uploadFile(imageBuffer, imageName);
      
      const metadataWithImage = {
        ...metadata,
        image: this.ipfsService.getIpfsUrl(imageHash)
      };
      
      const metadataHash = await this.ipfsService.uploadMetadata(metadataWithImage);
      
      const directoryMetadata = {
        name: uploadDto.title,
        metadata: this.ipfsService.getIpfsUrl(metadataHash),
        image: this.ipfsService.getIpfsUrl(imageHash)
      };
      
      const directoryHash = await this.ipfsService.uploadMetadata(directoryMetadata);
      
      return {
        directoryHash,
        directoryUrl: this.ipfsService.getIpfsUrl(directoryHash),
        metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
        imageUrl: this.ipfsService.getIpfsUrl(imageHash)
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process upload: ${error.message}`);
    }
  }
}
