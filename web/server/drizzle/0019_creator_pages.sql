CREATE TABLE "creator_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"alert_id" uuid,
	"symbol" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"venue" text DEFAULT '' NOT NULL,
	"strategy" text NOT NULL,
	"timeframe" text NOT NULL,
	"signal_time" text NOT NULL,
	"side" text NOT NULL,
	"label" text NOT NULL,
	"entry" double precision NOT NULL,
	"stop_loss" double precision NOT NULL,
	"take_profit" double precision NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_time" text,
	"gross_r" double precision,
	"cost_r" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "creator_signals_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "signal_alerts" ADD COLUMN "public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_profile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "creator_signals" ADD CONSTRAINT "creator_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_signals" ADD CONSTRAINT "creator_signals_event_id_signal_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."signal_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_signals" ADD CONSTRAINT "creator_signals_alert_id_signal_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."signal_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_signals_user_created_idx" ON "creator_signals" USING btree ("user_id","created_at");