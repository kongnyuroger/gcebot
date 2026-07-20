import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AdminAuthService, LoginResult, VerifyTotpResult } from './admin-auth.service';

interface LoginRequestBody {
  email?: string;
  password?: string;
}

interface VerifyTotpRequestBody {
  tempToken?: string;
  code?: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginRequestBody): Promise<LoginResult> {
    if (!body.email || !body.password) {
      throw new BadRequestException('email and password are required');
    }

    return this.adminAuthService.login(body.email, body.password);
  }

  @Post('verify-totp')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(@Body() body: VerifyTotpRequestBody): Promise<VerifyTotpResult> {
    if (!body.tempToken || !body.code) {
      throw new BadRequestException('tempToken and code are required');
    }

    return this.adminAuthService.verifyTotp(body.tempToken, body.code);
  }
}
