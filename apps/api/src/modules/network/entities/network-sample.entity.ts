import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type NetworkSampleStatus = "ok" | "degraded" | "down";

@Entity("network_samples")
@Index(["network", "sampledAt"])
@Index(["network", "horizonBaseUrl", "sampledAt"])
export class NetworkSample {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 16 })
  network: string;

  @Column({ name: "horizon_base_url" })
  horizonBaseUrl: string;

  @Column()
  ok: boolean;

  @Column({ name: "latency_ms", type: "integer", nullable: true })
  latencyMs: number | null = null;

  @Column({ type: "text", nullable: true })
  error: string | null = null;

  @Columb({
    name: "sampled_at",
    type: "timestamptz",
    default: () => "now()",
  })
  sampledAt: Date;

  /**
   * Derived connectivity status for the sample. Not persisted; computed
   * from the persisted ok latency fields so historical rows remain source
   * of truth and no backfill migration is required.
   */
  get status(): NetworkSampleStatus {
    if (!this.ok) {
      return "down";
    }
    if (this.latencyMs === null) {
      return "degraded";
    }
    return "ok";
  }
}
