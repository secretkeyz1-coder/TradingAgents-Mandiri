CREATE TABLE "spent_quota" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spent_quota" ADD CONSTRAINT "spent_quota_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spent_quota_user_idx" ON "spent_quota" USING btree ("user_id","kind","at");--> statement-breakpoint
CREATE INDEX "spent_quota_at_idx" ON "spent_quota" USING btree ("at");