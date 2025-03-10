import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import { UploadDto } from './dto/uploadDto';
import { Metadata, Attribute } from './interfaces/metadata.interfaces';
import axios from 'axios';

@Injectable()
export class UtilsService {
  private readonly width_default: number;
  private readonly height_default: number;
  private readonly ipfsGateway: string;

  constructor(private readonly configService: ConfigService) {
    const width = this.configService.get<string>('MAX_WIDTH', '512');
    this.width_default = parseInt(width);

    const height = this.configService.get<string>('MAX_HEIGHT', '512');
    this.height_default = parseInt(height);

    this.ipfsGateway = this.configService.get<string>(
      'IPFS_GATEWAY',
      'https://ipfs.io/ipfs',
    );
  }

  // region Image Processing
  public async processImage(imageBase64: string): Promise<string> {
    try {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      let imageFormat = 'png';
      const formatMatch = imageBase64.match(/^data:image\/(\w+);base64,/);
      if (formatMatch && formatMatch[1]) {
        imageFormat = formatMatch[1];
      }

      const resizedImageBuffer = await this.resizeBase64Image(imageBase64);
      return resizedImageBuffer;
    } catch (error) {
      // 	TODO: return the error
      console.log(error);
      throw new Error('Processing image failed with error:' + error.message);
    }
  }

  private async resizeBase64Image(imageBase64: string): Promise<string> {
    try {
      const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        throw new Error('Invalid base64 image format');
      }
      const format = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');

      // region Aspect Ratio resizeing
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
      //   endregion

      const resizedBuffer = await sharp(buffer)
        .resize(width, height)
        .toBuffer();

      const resizedBase64 = `data:image/${format};base64,${resizedBuffer.toString('base64')}`;
      return resizedBase64;
    } catch (error) {
      // TODO: return the error
      console.log(error);
      throw new Error('Resizing image failed with error:' + error.message);
    }
  }

  async fetchImageAsBase64(imageUrl: string): Promise<string> {
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
      throw new Error('Failed to fetch old image');
    }
  }

  async fetchNftData(
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
        throw new Error(
          `Failed to retrieve data or data is in unexpected format\n ${response.status}\n ${response.data}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to fetch NFT data for token\n ${identifier}: ${error.message}`,
      );
    }
  }

  public genRandImgName(len: number = 16): string {
    let result = '';
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < len; i++) {
      result += characters.charAt(Math.floor(Math.random() * len));
    }

    return result;
  }
  // 	endregion

  // 	region Metadata generation
  public generateMetadata(
    uploadDto: UploadDto,
    aiResponse: any,
    imageHash: string,
  ): Metadata {
    const aiResponseObj = JSON.parse(aiResponse);
    const uploadDtoAttributes = this.recurseParseObj(uploadDto, [
      'title',
      'description',
      'imageBase64',
    ]);
    const aiResponseAttributes = this.recurseParseObj(
      aiResponseObj,
      [],
      [],
      'xArtistsAI',
    );
    const atributes = [...uploadDtoAttributes, ...aiResponseAttributes];
    // #endregion

    const metadata = {
      title: uploadDto.title,
      description: uploadDto.description,
      url: this.getIpfsUrl(imageHash),
      attributes: atributes,
    };

    return metadata;
  }

  async getValidMetadata(attributes: string) {
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

  public recurseParseObj(
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

  getIpfsUrl(cid: string, path: string = ''): string {
    // Remove trailing slash from gateway if exists
    const gateway = this.ipfsGateway.endsWith('/')
      ? this.ipfsGateway.slice(0, -1)
      : this.ipfsGateway;

    // Add path if provided
    return path ? `${gateway}/${cid}/${path}` : `${gateway}/${cid}`;
  }
  // 	endregion
}
