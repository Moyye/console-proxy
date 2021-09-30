import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import fetch from 'node-fetch';
import { ForwardInRequestDto, ForwardInResponseDto } from './dto';
import { Forward } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly forwardService: Forward) {}

  @Post('/forward-in')
  async newForwardIn(
    @Body() body: ForwardInRequestDto,
  ): Promise<ForwardInResponseDto> {
    return this.forwardService.newForwardIn(body);
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

  @Get()
  ping(): string {
    return 'pong';
  }
}
