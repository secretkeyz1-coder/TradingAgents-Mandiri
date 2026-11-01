CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"symbol" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"label" text,
	"venue" text DEFAULT '' NOT NULL,
	"direction" text NOT NULL,
	"price" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"armed_bar" text,
	"triggered_at" timestamp with time zone,
	"triggered_price" double precision,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_active_idx" ON "price_alerts" USING btree ("active","symbol");--> statement-breakpoint
CREATE INDEX "price_alerts_user_idx" ON "price_alerts" USING btree ("user_id","created_at");