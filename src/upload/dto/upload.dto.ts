import { IsNumber, IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class UploadDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    description: string;

    @IsString()
    @IsNotEmpty()
    artist: string;

    @IsNumber()
    userId: number

    @IsBoolean()
    @IsNotEmpty()
    hasPhysicalAsset: boolean;

    @IsString()
    @IsNotEmpty()
    artworkType: string;

    physicalAssetDetails: PhysicalAssetDetails;

    @IsString()
    imageUrl:string;

    @IsString()
    @IsNotEmpty()
    imageBase64: string;
}

class PhysicalAssetDetails {
    @IsNumber()
    width: number;

    @IsNumber()
    height: number;

    @IsNumber()
    depth: number;

    @IsNumber()
    weight: number;

    @IsString()
    medium: string;

    @IsString()
    surface: string;

    @IsString()
    material: string;

    @IsString()
    technique: string;

    @IsBoolean()
    baseIncluded: boolean;
}