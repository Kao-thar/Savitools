import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type NetworkName = "mainnet" | "testnet";

/**
 * A single connectivity probe result against a Horizon endpoint for a given network.
 * Rows are append-only and form the basis for connectivity history and latency trends.
 */
@Entity("network_samples")
@Index(["network", "sampledAt"])
@Index(["network", "okStatus", "sampledAt"])
export class NetworkSample {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 16 })
  network: NetworkName;

  @Column({ name: "horizon_base_url" })
  horizoBaseUrl: string;

  /**
   * Whether the probe succeeded. Kept as a plain boolean for API/UI compatibility.
   */
  @Column()
  ok: boolean;

  /**
   * Denormalized copy of the `ok` flag that is safe to index and filter on in SQL.
   */
  @Column({ name: "ok_status", default: true })
  okStatus: boolean;

  /**
   * Round-trip latency in milliseconds. Null when the probe failed before a timing could be captured.
   */
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
