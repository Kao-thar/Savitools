import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NetworkController } from "./network.controller";
import { NetworkService } from "./network.service";
import { AuthModule } from "../auth/auth.module";
import { MetricsModule } from "../metrics/metrics.module";
import { NetworkSample } from "./entities/network-sample.entity";
import { NetworkProfile } from "./entities/network-profile.entity";
import { NetworkProfileHistory } from "./entities/network-profile-history.entity";
import { NetworkProfileHistoryService } from "./network-profile-history.service";

@Module({
  imports: [
    MetricsModule,
    AuthModule,
    TypeOrmModule.forFeature([NetworkSample, NetworkProfile, NetworkProfileHistory]),
  ],
  controllers: [NetworkController],
  providers: [NetworkService, NetworkProfileHistoryService],
  exports: [NetworkService],
})
export class NetworkModule {}
