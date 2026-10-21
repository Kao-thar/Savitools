import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("network_samples")
@Index(["network", "sampledAt"])
export class NetworkSample {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 16 })
  network: "mainnet" | "testnet";

  @Column({ name: "horizon_base_url" })
  horizonBaseUrl: string;

  @Column()
  ok: boolean;

  @Column({ name: "latency_ms", type: "integer", nullable: true })
  latencyMs: number | null;

  @Column({ type: "text", nullable: true })
  error: string | null;

  @Column({
    name: "sampled_at",
    type: "timestamptz",
    default: () => "now()",
  })
  sampledAt: Date;
}
