import { IsNumber, IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class ReuploadDTO {
    @IsString()
    @IsNotEmpty()
    metadata: string;

    @IsString()
    @IsNotEmpty()
    imageBase64: string;
}