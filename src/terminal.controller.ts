import { Controller, Get } from '@nestjs/common';
import { TerminalService } from './terminal.service';
import { ForwardService } from './forward.service';

@Controller()
export class TerminalController {
  constructor(
    private readonly terminalService: TerminalService,
    private readonly forwardService: ForwardService,
  ) {}

  @Get()
  ping(): string {
    return this.forwardService.ping();
  }
}
