import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import fetch from 'node-fetch';
import { ForwardInRequestDto, ForwardInResponseDto } from './dto';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('/forward-in')
  async newForwardIn(
    @Body() body: ForwardInRequestDto,
  ): Promise<ForwardInResponseDto> {
    return this.appService.newForwardIn(body);
  }

  @Delete('/forward/:id')
  async unForward(@Param('id') id: string) {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return;
    }
    await this.appService.unForward(id);
  }

  @Get('/forward-status')
  async forwardStatus() {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return;
    }
    return this.appService.forwardStatus();
  }

  @Get('/frpc-status')
  async frpcStatus() {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return [];
    }

    try {
      return await fetch('http://localhost:22335/api/status').then((res) =>
        res.json(),
      );
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  @Get('/frpc-reload')
  async frpcReload() {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return false;
    }

    try {
      await fetch('http://localhost:22335/api/reload');
      return true;
    } catch (error) {
      console.log(error);
      return false;
    }
  }

  @Get()
  ping(): string {
    return 'pong';
  }
}
