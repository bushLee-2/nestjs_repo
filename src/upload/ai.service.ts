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

        const width = this.configService.get<string>("WIDTH", "512")  
        this.width_default = parseInt(width)

        const height = this.configService.get<string>("HEIGHT", "512")
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

            const resizedBuffer = await sharp(buffer)
                                            .resize(
                                                this.width_default, 
                                                this.height_default)
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

            return response.choices[0].message.content;
        } catch(error) {
            throw new BadRequestException(`AI processing error: ${error.message || 'Unknown error'}`);
        }

    }

}