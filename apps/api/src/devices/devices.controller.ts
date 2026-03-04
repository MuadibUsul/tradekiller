import {
  Body,
  Controller,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { WebAuthGuard } from '../auth/web-auth.guard';
import { WebUser } from '../auth/web-user.decorator';
import type { WebAccessClaims } from '../auth/auth.types';

interface EnrollSessionBody {
  device_name?: unknown;
}

@Controller('api/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('enroll-session')
  @UseGuards(WebAuthGuard)
  async createEnrollSession(@Body() body: EnrollSessionBody, @WebUser() user: WebAccessClaims) {
    if (body.device_name !== undefined && typeof body.device_name !== 'string') {
      throw new UnauthorizedException('device_name must be a string when provided.');
    }

    return this.devicesService.createEnrollSession(user.uid, body.device_name);
  }
}
