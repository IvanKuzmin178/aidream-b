import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class PipelineTaskDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsOptional()
  jobId?: string;

  @IsNumber()
  @IsOptional()
  sceneIndex?: number;
}
