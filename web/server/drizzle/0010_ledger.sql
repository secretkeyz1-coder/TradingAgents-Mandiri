CREATE TABLE "ledger_recaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"signal_time" text NOT NULL,
	"signal_at" timestamp with time zone NOT NULL,
	"session" text NOT NULL,
	"side" text NOT NULL,
	"label" text NOT NULL,
	"entry" double precision NOT NULL,
	"stop_loss" double precision NOT NULL,
	"take_profit" double precision NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_time" text,
	"gross_r" double precision,
	"cost_r" double precision NOT NULL,
	"data_source" text NOT NULL,
	"live" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_recaps_kind_period_idx" ON "ledger_recaps" USING btree ("kind","period");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_signals_key_idx" ON "ledger_signals" USING btree ("source","symbol","timeframe","signal_time");--> statement-breakpoint
CREATE INDEX "ledger_signals_at_idx" ON "ledger_signals" USING btree ("signal_at");