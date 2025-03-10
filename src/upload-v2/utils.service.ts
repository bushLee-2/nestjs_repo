import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { UploadDto } from './dto/upload.dto';
import * as sharp from 'sharp';
import { ConfigService } from '@nestjs/config';

interface Attribute {
  trait_type: string;
  value: any;
}

interface Metadata {
  title: string;
  description: string;
  url: string;
  attributes: Attribute[];
}

@Injectable()
export class UtilsService {
  private readonly width_default: number;
  private readonly height_default: number;
  constructor(private readonly configService: ConfigService) {
    const width = this.configService.get<string>('MAX_WIDTH', '512');
    this.width_default = parseInt(width);

    const height = this.configService.get<string>('MAX_HEIGHT', '512');
    this.height_default = parseInt(height);
  }

  private recurseParseObj(
    obj: any,
    excludeKeys: string[] = [],
    attributes: Attribute[] = [],
    prefix: string = '',
  ): Attribute[] {
    if (obj === null || obj === undefined) {
      return attributes;
    }

    if (typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        if (excludeKeys.includes(key)) {
          continue;
        }

        const key_name = prefix ? `${prefix}_${key}` : key;
        if (
          value !== null &&
          value !== undefined &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          this.recurseParseObj(value, excludeKeys, attributes);
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            const arrayItemKey = `${prefix}_${key_name}_${i}`;

            if (
              item !== null &&
              item !== undefined &&
              typeof item === 'object'
            ) {
              this.recurseParseObj(item, excludeKeys, attributes, arrayItemKey);
            } else {
              attributes.push({
                trait_type: arrayItemKey,
                value: item,
              });
            }
          }
        } else {
          attributes.push({
            trait_type: key_name,
            value: value,
          });
        }
      }
    }

    return attributes;
  }

  private async fetchNftData(
    identifier: string,
    baseUrl: string = 'https://devnet-api.multiversx.com/nfts',
  ): Promise<{ oldMetadata: Metadata; originalUrl: string; rawNft: any }> {
    try {
      const url = `${baseUrl}/${identifier}`;
      const response = await axios.get(url);

      console.log(response.data);

      if (response.status === 200 && response.data) {
        const { attributes, media } = response.data;

        const metadata = await this.getValidMetadata(attributes);

        const originalUrl =
          media && media.length > 0 ? media[0].originalUrl : null;

        return {
          oldMetadata: metadata,
          originalUrl,
          rawNft: response.data,
        };
      } else {
        throw new BadRequestException(
          `Failed to retrieve data or data is in unexpected format\n ${response.status}\n ${response.data}`,
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch NFT data for token\n ${identifier}: ${error.message}`,
      );
    }
  }

  private async getValidMetadata(attributes: string) {
    try {
      const metadataCid = Buffer.from(attributes, 'base64')
        .toString('utf-8')
        .split(';')
        .filter((attr) => attr.startsWith('metadata'))[0]
        .split(':')[1];
      const metadataJsonUri = `https://ipfs.io/ipfs/${metadataCid}`;
      const metadataJson = await fetch(metadataJsonUri).then((res) =>
        res.json(),
      );
      console.log('Fetched ipfs metadata', metadataJson);
      return metadataJson;
    } catch (err) {
      console.warn('Failed to fetch metadata for NFT', err);
      return {};
    }
  }

  private async fetchImageAsBase64(imageUrl: string): Promise<string> {
    try {
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: new URL(imageUrl).origin,
      };
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers,
      });

      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const contentType = response.headers['content-type'] || 'image/jpeg';

      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Failed to fetch old image');
    }
  }

  private getRandomName(): string {
    let name = '';
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < characters.length; i++) {
      name += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return name;
  }

  async resizeBase64Image(base64Img: string): Promise<string> {
    try {
      const matches = base64Img.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        throw new BadRequestException('Invalid base64 image format');
      }
      const format = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');

      // #region Aspect Ratio resizeing
      const metadata = await sharp(buffer).metadata();
      let width = this.width_default;
      let height = this.height_default;

      if (metadata.width && metadata.height) {
        const aspectRatio = metadata.width / metadata.height;

        if (aspectRatio > 1) {
          width = this.width_default;
          height = Math.floor(width / aspectRatio);

          if (height > this.height_default) {
            height = this.height_default;
            width = Math.floor(height * aspectRatio);
          }
        } else {
          height = this.height_default;
          width = Math.floor(height * aspectRatio);

          if (width > this.width_default) {
            width = this.width_default;
            height = Math.floor(width / aspectRatio);
          }
        }
      }
      //   #endregion

      const resizedBuffer = await sharp(buffer)
        .resize(width, height)
        .toBuffer();

      const resizedBase64 = `data:image/${format};base64,${resizedBuffer.toString('base64')}`;
      return resizedBase64;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Failed to Resize Image');
    }
  }

  private async imageProbess(base64Img: string) {
    try {
      const base64Data = base64Img.replace(/^data:image\/\w+;base64,/, '');

      let imageFormat = 'png';
      const formatMatch = base64Img.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');

      const resizedImageBuffer = await this.resizeBase64Image(base64Img);
    } catch (error) {}
  }
}
