import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import fetch from 'node-fetch';
import { ForwardInRequestDto, ForwardInResponseDto } from './dto';
import { InnerForward } from './app.service';
import { ErrorCatch } from './utils/kit';

@Controller()
export class AppController {
  constructor(private readonly forwardService: InnerForward) {}

  @Post('/forward')
  @ErrorCatch()
  async newForwardIn(
    @Body() body: ForwardInRequestDto,
  ): Promise<ForwardInResponseDto> {
    return this.forwardService.startForward(
      body,
      body.type === 'IN' ? 'forwardIn' : 'forwardOut',
    );
  }

  @Delete('/forward/:id')
  async unForward(@Param('id') id: string) {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return;
    }
    await this.forwardService.unForward(id);
  }

  @Get('/forward-status')
  async forwardStatus() {
    if (process.env.RUNTIME_ENV === 'OFFICE') {
      return;
    }
    return this.forwardService.forwardStatus();
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
