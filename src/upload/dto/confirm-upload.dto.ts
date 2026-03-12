import { IsArray, IsString } from 'class-validator';

export class ConfirmUploadDto {
  @IsArray()
  @IsString({ each: true })
  objectPaths!: string[];
}
