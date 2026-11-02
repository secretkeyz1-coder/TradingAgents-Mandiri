CREATE TABLE "journal_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"venue" text DEFAULT '' NOT NULL,
	"side" text NOT NULL,
	"entry" double precision NOT NULL,
	"stop_loss" double precision NOT NULL,
	"take_profit" double precision NOT NULL,
	"source" text NOT NULL,
	"label" text,
	"mood" text,
	"note" text,
	"risk_idr" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"armed_bar" text,
	"exit_price" double precision,
	"r" double precision,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "journal_trades" ADD CONSTRAINT "journal_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_trades_user_idx" ON "journal_trades" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "journal_trades_status_idx" ON "journal_trades" USING btree ("status");