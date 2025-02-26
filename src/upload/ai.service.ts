import { Injectable, BadRequestException} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import * as sharp from 'sharp';

@Injectable()
export class AiService{
    private readonly aiServiceApiKey: string;

    private readonly systemPrompt: string;
    private readonly userPrompt: string;

    private readonly width_default: number;
    private readonly height_default: number;

    constructor(private configService: ConfigService) {
        this.aiServiceApiKey = this.configService.get<string>("OPENAI_API_KEY", "")

        this.systemPrompt = this.configService.get<string>("SYSTEM_PROMPT", "")
        this.userPrompt = this.configService.get<string>("USER_PROMPT", "")

        const width = this.configService.get<string>("MAX_WIDTH", "512")  
        this.width_default = parseInt(width)

        const height = this.configService.get<string>("MAX_HEIGHT", "512")
        this.height_default = parseInt(height)
    }

    async resizeBase64Image(base64Img: string): Promise<string>{
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
                                            .resize(
                                                width, 
                                                height)
                                            .toBuffer()

            const resizedBase64 = `data:image/${format};base64,${resizedBuffer.toString('base64')}`;
            return resizedBase64 
        } catch(error) {
            console.log(error)
            throw new BadRequestException('Failed to Resize Image');
        }
    }

    async aiProcessImage(base64Image: string): Promise<string> {
        try {
            const openai = new OpenAI()

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                {
                    role: "system",
                    content: this.systemPrompt 
                },
                {
                    role: "user",
                    content: [
                    { type: "text", text: this.userPrompt},
                    {
                        type: "image_url",
                        image_url: {
                        "url": base64Image,
                        "detail":"low"
                        },
                    },
                    ],
                },
                ],
                store: true,
            });

            if (!response.choices || 
                response.choices.length === 0 || 
                !response.choices[0].message || 
                !response.choices[0].message.content) {
                throw new BadRequestException('AI returned an invalid or empty response');
            }

            let aiResponse = response.choices[0].message.content;
            aiResponse = aiResponse.replaceAll("`", "")
            aiResponse = aiResponse.substring(4)

            return aiResponse 
        } catch(error) {
            throw new BadRequestException(`AI processing error: ${error.message || 'Unknown error'}`);
        }

    }

}