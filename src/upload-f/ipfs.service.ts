import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as FormData from 'form-data';

@Injectable()
export class IpfsService {
  private readonly ipfsGateway: string;
  private readonly pinningServiceUrl: string;
  private readonly pinningServiceApiKey: string;

  constructor(private configService: ConfigService) {
    this.ipfsGateway = this.configService.get<string>(
      'IPFS_GATEWAY',
      'https://ipfs.io/ipfs',
    );

    this.pinningServiceUrl = this.configService.get<string>(
      'PINATA_API_URL',
      'https://api.pinata.cloud/pinning',
    );
    this.pinningServiceApiKey = this.configService.get<string>(
      'PINATA_JWT',
      '',
    );
  }

  async uploadFile(fileBuffer: Buffer, fileName: string): Promise<string> {
    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', fileBuffer, { filename: fileName });

      // Call Pinata API to pin the file
      const response = await axios.post(
        `${this.pinningServiceUrl}/pinFileToIPFS`,
        formData,
        {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
            Authorization: `Bearer ${this.pinningServiceApiKey}`,
          },
        },
      );

      // Return the IPFS hash
      return response.data.IpfsHash;
    } catch (error) {
      throw new BadRequestException(`IPFS upload failed: ${error.message}`);
    }
  }

  async uploadMetadata(metadata: any): Promise<string> {
    try {
      // Call Pinata API to pin JSON
      const response = await axios.post(
        `${this.pinningServiceUrl}/pinJSONToIPFS`,
        metadata,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.pinningServiceApiKey}`,
          },
        },
      );

      // Return the IPFS hash
      return response.data.IpfsHash;
    } catch (error) {
      throw new BadRequestException(
        `IPFS metadata upload failed: ${error.message}`,
      );
    }
  }

  getIpfsUrl(cid: string, path: string = ''): string {
    // Remove trailing slash from gateway if exists
    const gateway = this.ipfsGateway.endsWith('/')
      ? this.ipfsGateway.slice(0, -1)
      : this.ipfsGateway;

    // Add path if provided
    return path ? `${gateway}/${cid}/${path}` : `${gateway}/${cid}`;
  }
}
