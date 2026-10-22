import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NetworkController } from "./network.controller";
import { NetworkService } from "./network.service";
import { AuthModule } from "../auth/auth.module";
import { MetricsModule } from "../metrics/metrics.module";
import { NetworkSample } from "./entities/network-sample.entity";
import { NetworkProfile } from "./entities/network-profile.entity";

@Module({
  imports: [
    MetricsModule,
    AuthModule,
    TypeOrmModule.forFeature([NetworkSample, NetworkProfile]),
  ],
  controllers: [NetworkController],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule {}
