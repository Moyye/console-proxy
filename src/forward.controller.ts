import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ForwardService } from './forward.service';
import { ForwardInRequestDto, ForwardInResponseDto } from './dto';

@Controller()
export class ForwardController {
  constructor(private readonly forwardService: ForwardService) {}

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
