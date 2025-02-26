// First, ensure IpfsService is exported with @Injectable()
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsService } from './ipfs.service';
import { UploadDto } from './dto/upload.dto';
import { AiService } from './ai.service';
import { time } from 'console';


interface IpfsUploadResult {
  metadataUrl: string;
  imageUrl: string;
}

interface AiAnalysis {
  style_recognition: string;
  color_palette: string;
  composition_analysis_balance: string;
  composition_analysis_focus: string;
  unique_features: string;
}

interface Attribute {
  trait_type: string;
  value: any;
}

interface Metadata {
  title: string;
  description: string;
  atributes: Attribute[];
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
      const aiResponse = await this.aiService.aiProcessImage(resizedImageBuffer);
      const aiResponseObj = JSON.parse(aiResponse)
      console.log(aiResponse)

      let uploadDtoAttributes = this.recurseParseObj(uploadDto, ["title", "description", "imageBase64"])
      console.log(uploadDtoAttributes)
      let aiResponseAttributes = this.recurseParseObj(aiResponseObj, [], [], "xArtistsAI")
      const atributes = [...uploadDtoAttributes, ...aiResponseAttributes]
      console.log(uploadDtoAttributes)
      console.log(atributes)

      const metadata = {
        title: uploadDto.title,
        description: uploadDto.description,
        atributes: atributes
      }
 
      const imageName = `image.${imageFormat}`;
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
