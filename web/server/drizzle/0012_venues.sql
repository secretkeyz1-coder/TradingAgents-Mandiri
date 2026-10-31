DROP INDEX "ledger_signals_key_idx";--> statement-breakpoint
DROP INDEX "signal_alerts_user_pair_idx";--> statement-breakpoint
ALTER TABLE "ledger_signals" ADD COLUMN "venue" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_alerts" ADD COLUMN "venue" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_signals_key_idx" ON "ledger_signals" USING btree ("source","symbol","timeframe","venue","signal_time");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_alerts_user_pair_idx" ON "signal_alerts" USING btree ("user_id","symbol","indicator","timeframe","venue");