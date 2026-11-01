CREATE TABLE "server_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"source" text NOT NULL,
	"method" text,
	"path" text,
	"user_id" uuid,
	"message" text NOT NULL,
	"stack" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_errors" ADD CONSTRAINT "server_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_errors_created_at_idx" ON "server_errors" USING btree ("created_at");