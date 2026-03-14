import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { ModelsService } from './models.service';
import { OutputType } from './vertex-ai-models.constants';

@Controller('api/models')
@UseGuards(FirebaseAuthGuard)
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  list(@Query('outputType') outputType?: OutputType) {
    return this.modelsService.list(outputType);
  }
}
