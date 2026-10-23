import {
  Controller,
  Get,
  Query,
  Post,
  Body,
  Param,
  Put,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateNetworkProfileDto } from './dto/create-network-profile.dto';
import { ImportNetworkProfileDto } from './dto/import-network-profile.dto';
import { RecordConnectivityDto } from './dto/record-connectivity.dto';
import { UpdateNetworkProfileDto } from './dto/update-network-profile.dto';
import { VerifyNetworkPassphraseDto } from './dto/verify-network-passphrase.dto';
import { NetworkService } from './networkService';

@ApiTags('network')
@Controller('network')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current Stellar network status and fees' })
  @ApiQuery({
    name: 'network',
    required: false,
    enum: ['mainnet', 'testnet'],
    description: 'Network to query (default: mainnet)',
  })
  @ApiResponse({ status: 200, description: 'Network status retrieved' })
  async getStatus(@Query('network') network: string = 'mainnet') {
    const net = network === 'testnet' ? 'testnet' : 'mainnet';
    return this.networkService.fetchCurrentStatus(net);
  }

  @Get('status/history')
  @ApiOperation({ summary: 'Get network status history and uptime metrics' })
  @ApiQuery({
    name: 'network',
    required: false,
    enum: ['mainnet', 'testnet'],
    description: 'Network to query (default: mainnet)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO date lower bound (default: 60 minutes before to)',
  })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date upper bound (default: now)' })
  @ApiResponse({ status: 200, description: 'Network status history retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid network or ISO date range' })
  async getHistory(
    @Query('network') network: string = 'mainnet',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const net = network === 'testnet' ? 'testnet' : 'mainnet';
    return this.networkService.getHistory(net, from, to);
  }

  @Get('profiles')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List network profiles for the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of profiles returned' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  listProfiles(@CurrentUser() user: { id: string }) {
    return this.networkService.listNetworkProfiles(user.id);
  }

  @Post('profiles')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Create a new network profile' })
  @ApiResponse({ status: 201, description: 'Profile created' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  createProfile(@CurrentUser() user: { id: string }, @Body() body: CreateNetworkProfileDto) {
    return this.networkService.createNetworkProfile(user.id, body);
  }

  @Put('profiles/:id')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a network profile' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  updateProfile(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdateNetworkProfileDto,
  ) {
    return this.networkService.updateNetworkProfile(user.id, id, body);
  }

  @Delete('profiles/:id')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a network profile' })
  @ApiResponse({ status: 200, description: 'Profile deleted' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async deleteProfile(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    await this.networkService.deleteNetworkProfile(user.id, id);
    return { success: true };
  }

  @Post('profiles/verify')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a Horizon URL network passphrase' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  verifyPassphrase(@Body() body: VerifyNetworkPassphraseDto) {
    return this.networkService.verifyNetworkPassphrase(
      body.horizonUrl,
      body.expectedPassphrase ?? '',
    );
  }

  @Put('profiles/:id/default')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a profile as the default for startup' })
  @ApiResponse({ status: 200, description: 'Profile marked as default' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  setDefaultProfile(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.networkService.setDefaultNetworkProfile(user.id, id);
  }

  @Get('profiles/:id/export')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Export a profile as JSON' })
  @ApiResponse({ status: 200, description: 'Profile exported as JSON' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  exportProfile(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.networkService.exportNetworkProfile(user.id, id);
  }

  @Post('profiles/import')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Import a network profile from JSON' })
  @ApiResponse({ status: 201, description: 'Profile imported' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  importProfile(@CurrentUser() user: { id: string }, @Body() body: ImportNetworkProfileDto) {
    return this.networkService.importNetworkProfile(user.id, body);
  }

  @Get('profiles/:id/history')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Get connectivity history and latency trends for a profile' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO date lower bound (default: 24 hours before to)',
  })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date upper bound (default: now)' })
  @ApiQuery({
    name: 'bucket',
    required: false,
    enum: ['minute', 'hour', 'day'],
    description: 'Aggregation bucket for latency trends (default: hour)',
  })
  @ApiResponse({ status: 200, description: 'Connectivity history and latency trends retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid ISO date range or bucket' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  getProfileHistory(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bucket') bucket?: string,
  ) {
    return this.networkService.getProfileHistory(user.id, id, { from, to, bucket });
  }

  @Post('profiles/:id/history')
  UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a connectivity check for a profile' })
  @ApiResponse({ status: 201, description: 'Connectivity check recorded' })
  @ApiResponse({ status: 400, description: 'Invalid connectivity check payload' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  recordProfileConnectivity(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() body: RecordConnectivityDto,
  ) {
    return this.networkService.recordProfileConnectivity(user.id, id, body);
  }
}
