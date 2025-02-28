import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsService } from './ipfs.service';
import { UploadDto } from './dto/upload.dto';
import { AiService } from './ai.service';
import { ReassesDTO } from './dto/reasses.dto';
import axios from 'axios';
import { identity } from 'rxjs';
import { ReuploadDTO } from './dto/reupload.dto';


interface IpfsUploadResult {
  metadataUrl: string;
  imageUrl: string;
}

interface Attribute {
  trait_type: string;
  value: any;
}

interface Metadata {
  title: string;
  description: string;
  attributes: Attribute[];
}


@Controller('upload')
export class UploadController {
  constructor(
    private readonly ipfsService: IpfsService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService
  ) {}


  private recurseParseObj(obj: any, excludeKeys: string[]=[], attributes: Attribute[] = [], prefix:string=""): Attribute[] {
    if (obj === null || obj === undefined) {
      return attributes;
    }

    if (typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        if (excludeKeys.includes(key)) {
          continue;
        }

        const key_name = prefix ? `${prefix}_${key}` : key;
        if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
          this.recurseParseObj(value, excludeKeys, attributes);
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            const arrayItemKey = `${prefix}_${key_name}_${i}`;
            
            if (item !== null && item !== undefined && typeof item === 'object') {
              this.recurseParseObj(item, excludeKeys, attributes, arrayItemKey);
            } else {
              attributes.push({
                trait_type: arrayItemKey,
                value: item
              });
            }
          }
        } else {
          attributes.push({
            trait_type: key_name,
            value: value
          });
        } 
      }
    }

    return attributes
  }

  private async fetchNftData(identifier: string, baseUrl: string="https://devnet-api.multiversx.com/nfts"): Promise<{oldMetadata: Metadata, originalUrl: string}> {
    try {
      const url = `${baseUrl}/${identifier}`;
      
      const response = await axios.get(url);
      
      if (response.status === 200 && response.data) {
        const { metadata, media } = response.data;
        
        const originalUrl = media && media.length > 0 ? media[0].originalUrl : null;

        return {
          oldMetadata: metadata,
          originalUrl
        };
   
      } else {
        throw new BadRequestException(`Failed to retrieve data or data is in unexpected format\n ${response.status}\n ${response.data}`);
      }
    } catch (error) {
      throw new BadRequestException(`Failed to fetch NFT data for token\n ${identifier}: ${error.message}`);
    }
  }

  private async fetchImageAsBase64(imageUrl: string): Promise<string> {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(imageUrl).origin, 
      };
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers
      });
      
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const contentType = response.headers['content-type'] || 'image/jpeg'; 

      return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.log(error)
        throw new BadRequestException('Failed to fetch old image');
    }
  }

  @Post('')
  async uploadToIpfs(@Body() uploadDto: UploadDto): Promise<IpfsUploadResult> {
    try {
      const base64Data = uploadDto.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      
      let imageFormat = 'png';
      const formatMatch = uploadDto.imageBase64.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      const resizedImageBuffer = await this.aiService.resizeBase64Image(uploadDto.imageBase64) 
      const aiResponse = await this.aiService.aiProcessImage(resizedImageBuffer, uploadDto.hasPhysicalAsset);
      const aiResponseObj = JSON.parse(aiResponse)
      console.log(aiResponse)

      let uploadDtoAttributes = this.recurseParseObj(uploadDto, ["title", "description", "imageBase64"])
      let aiResponseAttributes = this.recurseParseObj(aiResponseObj, [], [], "xArtistsAI")
      const atributes = [...uploadDtoAttributes, ...aiResponseAttributes]

      const metadata = {
        title: uploadDto.title,
        description: uploadDto.description,
        atributes: atributes
      }

      let randImageName = "";
      const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for ( let i = 0; i < charactersLength; i++ ) {
          randImageName+= characters.charAt(Math.floor(Math.random() * charactersLength));
      }
 
      const imageName = `${randImageName}.${imageFormat}`;
      const imageHash = await this.ipfsService.uploadFile(imageBuffer, imageName);
      const metadataHash = await this.ipfsService.uploadMetadata(metadata);
      
      return {
        metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
        imageUrl: this.ipfsService.getIpfsUrl(imageHash)
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process upload: ${error.message}`);
    }
  }

  @Post('reasess')
  async reasessAndUploadToIpfs(@Body() reassesDTO: ReassesDTO): Promise<IpfsUploadResult> {
    try{
      // #region process the new base64 image
      const base64Data = reassesDTO.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      let imageFormat = 'png';
      const formatMatch = reassesDTO.imageBase64.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const resizedImageBuffer = await this.aiService.resizeBase64Image(reassesDTO.imageBase64)
      // #endregion

      const {oldMetadata, originalUrl } = await this.fetchNftData(reassesDTO.tokenIdentifier); 
      // #region process the old image 
      let oldImageBase64 = await this.fetchImageAsBase64(originalUrl);
      const oldBase64Data = oldImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let oldImageFormat = 'png';
      const oldFormatMatch = oldImageBase64.match(/^data:image\/(\w+);base64,/);
      if (oldFormatMatch && oldFormatMatch[1]) {
        oldImageFormat = oldFormatMatch[1];
      }
      const oldImageBuffer = Buffer.from(oldBase64Data, 'base64');
      const oldResizedImageBuffer = await this.aiService.resizeBase64Image(oldImageBase64)  
      // #endregion

      const aiResponse = await this.aiService.aiReassesImage(resizedImageBuffer, JSON.stringify(oldMetadata), oldResizedImageBuffer);
      const aiResponseObj = JSON.parse(aiResponse)

      let reassesAttributes = this.recurseParseObj(aiResponseObj, [], [], "xArtistsAI")  
      oldMetadata.attributes = [...oldMetadata.attributes, ...reassesAttributes]
      console.log("Reassesed atributes\n", reassesAttributes)
      console.log("Metadata", oldMetadata)

      let randImageName = "";
      const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for ( let i = 0; i < charactersLength; i++ ) {
          randImageName+= characters.charAt(Math.floor(Math.random() * charactersLength));
      }
 
      const imageName = `${randImageName}.${imageFormat}`;
      const imageHash = await this.ipfsService.uploadFile(imageBuffer, imageName);
      const metadataHash = await this.ipfsService.uploadMetadata(oldMetadata);
      
      return {
        metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
        imageUrl: this.ipfsService.getIpfsUrl(imageHash)
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process upload: ${error.message}`);
    }
  }

  @Post('reupload')
  async reuploadToIpfs(@Body() reupload: ReuploadDTO): Promise<IpfsUploadResult> {
    try {
      let metadata: any;
      try {
        metadata = JSON.parse(reupload.metadata);
      } catch (error) {
        throw new BadRequestException('Invalid metadata JSON format');
      }

      const base64Data = reupload.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      
      let imageFormat = 'png';
      const formatMatch = reupload.imageBase64.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }
      const imageBuffer = Buffer.from(base64Data, 'base64');

      let randImageName = "";
      const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for ( let i = 0; i < charactersLength; i++ ) {
          randImageName+= characters.charAt(Math.floor(Math.random() * charactersLength));
      }
 
      const imageName = `${randImageName}.${imageFormat}`;
      const imageHash = await this.ipfsService.uploadFile(imageBuffer, imageName);
      const metadataHash = await this.ipfsService.uploadMetadata(metadata);

      return {
        metadataUrl: this.ipfsService.getIpfsUrl(metadataHash),
        imageUrl: this.ipfsService.getIpfsUrl(imageHash)
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process upload: ${error.message}`);
    }
  }
}
