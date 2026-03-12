import { IsString, IsOptional, IsIn } from 'class-validator';
import { ProjectStyle } from '../entities/project.entity';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsIn(['memory', 'cinematic', 'dream'])
  @IsOptional()
  style?: ProjectStyle;
}
