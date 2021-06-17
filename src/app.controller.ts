import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
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
    await this.appService.unForward(id);
  }

  @Get('/forward-status')
  async forwardStatus() {
    return this.appService.forwardStatus();
  }

  @Get()
  ping(): string {
    return 'pong';
  }
}
