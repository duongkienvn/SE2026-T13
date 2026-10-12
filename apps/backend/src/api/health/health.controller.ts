import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { HealthResponseDto } from './health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @ApiExcludeEndpoint()
  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }

  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ type: HealthResponseDto })
  @Get('health')
  getHealthRoute(): HealthResponseDto {
    return this.healthService.getHealth();
  }
}
