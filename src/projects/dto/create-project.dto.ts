import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ProjectStyle } from '../entities/project.entity';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsIn(['memory', 'cinematic', 'dream'])
  style!: ProjectStyle;
}
