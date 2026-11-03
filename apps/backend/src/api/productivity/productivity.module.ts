import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Card } from '../cards/entities/card.entity';
import { ProductivityController } from './productivity.controller';
import { ProductivityService } from './productivity.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Card])],
  controllers: [ProductivityController],
  providers: [ProductivityService],
})
export class ProductivityModule {}
