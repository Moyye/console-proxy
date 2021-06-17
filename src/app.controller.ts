import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { TerminalService } from './terminal.service';
import { ForwardService } from './forward.service';
import { ForwardInRequestDto, ForwardInResponseDto } from './dto';

@Controller()
export class AppController {
  constructor(
    private readonly terminalService: TerminalService,
    private readonly forwardService: ForwardService,
  ) {}

  @Get()
  ping(): string {
    return this.forwardService.ping();
  }

  @Post('/forward-in')
  async newForwardIn(
    @Body() body: ForwardInRequestDto,
  ): Promise<ForwardInResponseDto> {
    return this.forwardService.newForwardIn(body);
  }

  @Delete('/forward/:id')
  async unForward(@Param('id') id: string) {
    await this.forwardService.unForward(id);
  }

  @Get('/forward-status')
  async forwardStatus() {
    return this.forwardService.forwardStatus();
  }
}
