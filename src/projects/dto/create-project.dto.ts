import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ProjectStyle, GenerationType, OutputType } from '../entities/project.entity';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsIn(['memory', 'cinematic', 'dream'])
  style!: ProjectStyle;

  @IsIn(['video', 'image', 'audio'])
  outputType!: OutputType;

  @IsOptional()
  @IsIn(['image_to_video', 'text_to_video'])
  generationType?: GenerationType;

  @IsString()
  @IsNotEmpty()
  modelId!: string;

  @IsOptional()
  @IsString()
  prompt?: string;
}
