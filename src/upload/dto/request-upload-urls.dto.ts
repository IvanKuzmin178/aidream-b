import { IsArray, ValidateNested, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class FileRequest {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  size!: number;
}

export class RequestUploadUrlsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileRequest)
  files!: FileRequest[];
}
