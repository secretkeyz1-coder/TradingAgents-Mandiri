CREATE TABLE "activity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"symbol" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_minutes" (
	"user_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"screen" text NOT NULL,
	"tab" text,
	"symbol" text
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_minutes" ADD CONSTRAINT "activity_minutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_user_at_idx" ON "activity_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "activity_events_at_idx" ON "activity_events" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_minutes_user_minute_idx" ON "activity_minutes" USING btree ("user_id","minute");--> statement-breakpoint
CREATE INDEX "activity_minutes_minute_idx" ON "activity_minutes" USING btree ("minute");