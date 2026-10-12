import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { HealthResponseDto, ReadinessResponseDto } from './health-response.dto';
import { HealthService } from './health.service';
import { SkipResponseWrap } from '../../decorators/response.decorators';
import { ApiCommonErrors } from '../../decorators/swagger-response.decorators';
import { ReadinessService } from './readiness.service';

@ApiTags('Health')
@SkipResponseWrap()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly readinessService: ReadinessService,
  ) {}

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

  @ApiOperation({ summary: 'PostgreSQL readiness check' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiCommonErrors([503])
  @Get('health/ready')
  checkReadiness(): Promise<ReadinessResponseDto> {
    return this.readinessService.check();
  }
}
