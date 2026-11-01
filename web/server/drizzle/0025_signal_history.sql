ALTER TABLE "signal_events" DROP CONSTRAINT "signal_events_alert_id_signal_alerts_id_fk";
--> statement-breakpoint
ALTER TABLE "signal_events" ALTER COLUMN "alert_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "symbol" text;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "tv_symbol" text;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "indicator" text;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "timeframe" text;--> statement-breakpoint
ALTER TABLE "signal_events" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_alert_id_signal_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."signal_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_events_user_created_idx" ON "signal_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Signals recorded before these columns take their owner and pair from the alert they came from.
UPDATE "signal_events" AS e SET "user_id" = a."user_id", "symbol" = a."symbol", "tv_symbol" = a."tv_symbol", "indicator" = a."indicator", "timeframe" = a."timeframe", "venue" = a."venue" FROM "signal_alerts" AS a WHERE a."id" = e."alert_id";
