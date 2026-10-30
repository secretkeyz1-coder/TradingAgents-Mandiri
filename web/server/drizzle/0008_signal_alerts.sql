CREATE TABLE "signal_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"symbol" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"indicator" text NOT NULL,
	"timeframe" text NOT NULL,
	"primed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"signal_time" text NOT NULL,
	"side" text NOT NULL,
	"label" text NOT NULL,
	"entry" double precision NOT NULL,
	"stop_loss" double precision NOT NULL,
	"take_profit" double precision NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_time" text,
	"notified_at" timestamp with time zone,
	"close_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_alerts" ADD CONSTRAINT "signal_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_alert_id_signal_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."signal_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_alerts_user_pair_idx" ON "signal_alerts" USING btree ("user_id","symbol","indicator","timeframe");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_events_alert_time_idx" ON "signal_events" USING btree ("alert_id","signal_time");