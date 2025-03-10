import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as sharp from 'sharp';

@Injectable()
export class AiService {
  private readonly aiServiceApiKey: string;

  private readonly systemPrompt: string;
  private readonly userPrompt: string;

  private readonly reassesmentSystemPrompt: string;
  private readonly reassesmentUserPrompt: string;

  private readonly width_default: number;
  private readonly height_default: number;

  constructor(private configService: ConfigService) {
    this.aiServiceApiKey = this.configService.get<string>('OPENAI_API_KEY', '');

    this.systemPrompt = this.configService.get<string>('SYSTEM_PROMPT', '');
    this.userPrompt = this.configService.get<string>('USER_PROMPT', '');

    this.reassesmentSystemPrompt = this.configService.get<string>(
      'REASSESSMENT_SYSTEM_PROMPT',
      '',
    );
    this.reassesmentUserPrompt = this.configService.get<string>(
      'REASSESSMENT_USER_PROMPT',
      '',
    );

    const width = this.configService.get<string>('MAX_WIDTH', '512');
    this.width_default = parseInt(width);

    const height = this.configService.get<string>('MAX_HEIGHT', '512');
    this.height_default = parseInt(height);
  }

  public async aiProcessImage(
    base64Image: string,
    hasPhysicalAsset,
  ): Promise<string> {
    try {
      const openai = new OpenAI();
      let userPrompt = '';
      if (hasPhysicalAsset) {
        userPrompt = this.userPrompt;
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.systemPrompt,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: base64Image,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        store: true,
      });

      if (
        !response.choices ||
        response.choices.length === 0 ||
        !response.choices[0].message ||
        !response.choices[0].message.content
      ) {
        throw new BadRequestException(
          'AI returned an invalid or empty response',
        );
      }

      let aiResponse = response.choices[0].message.content;
      aiResponse = aiResponse.replaceAll('`', '');
      aiResponse = aiResponse.substring(4);

      return aiResponse;
    } catch (error) {
      throw new BadRequestException(
        `AI processing error: ${error.message || 'Unknown error'}`,
      );
    }
  }

  public async aiReassesImage(
    base64Image: string,
    metadata: string,
    oldBase64Image: string,
  ): Promise<string> {
    try {
      const openai = new OpenAI();
      let userPrompt = '';
      const unixTimestamp: number = Math.floor(Date.now() / 1000);
      userPrompt = `I'm providing you with two images of the same artwork taken at different times for your expert reassessment. 
                            Keep in mind this is the metadata that describes the old image:The first image shows the artwork as it appeared during its initial assessment on [DATE]. Here's the metadata and initial evaluation:\n ${metadata}
                            Please carefully compare these images and provide:
                                1. A reassessment noting any changes in condition, appearance, or other relevant factors.Keep it concise and relatively short (< 100 words, less is preferred) while preserving the desired quality.
                                2. A new score from 1-100
                            Your response should be JSON. The keys that hold this should be named assessment_${unixTimestamp}_score, assessment_${unixTimestamp}_remarks. 
                        `;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.reassesmentSystemPrompt,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: base64Image,
                  detail: 'low',
                },
              },
              {
                type: 'image_url',
                image_url: {
                  url: oldBase64Image,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        store: true,
      });

      if (
        !response.choices ||
        response.choices.length === 0 ||
        !response.choices[0].message ||
        !response.choices[0].message.content
      ) {
        throw new BadRequestException(
          'AI returned an invalid or empty response',
        );
      }

      let aiResponse = response.choices[0].message.content;
      aiResponse = aiResponse.replaceAll('`', '');
      aiResponse = aiResponse.substring(4);

      return aiResponse;
    } catch (error) {
      throw new BadRequestException(
        `AI processing error: ${error.message || 'Unknown error'}`,
      );
    }
  }
}
