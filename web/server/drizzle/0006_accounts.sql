CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"daily_analysis_limit" integer,
	"daily_chat_limit" integer,
	"telegram_chat_id" text,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "watch_runs" DROP CONSTRAINT "watch_runs_pkey";--> statement-breakpoint
ALTER TABLE "watchlist" DROP CONSTRAINT "watchlist_pkey";--> statement-breakpoint
ALTER TABLE "agent_memories" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "chart_drawings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_drawings" ADD CONSTRAINT "chart_drawings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_user_idx" ON "analyses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_runs_user_day_idx" ON "watch_runs" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_symbol_idx" ON "watchlist" USING btree ("user_id","symbol");