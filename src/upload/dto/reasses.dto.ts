import { IsNumber, IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class ReassesDTO {
    @IsString()
    @IsNotEmpty()
    tokenIdentifier: string;

    @IsString()
    @IsNotEmpty()
    imageBase64: string;
}