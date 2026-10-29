CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"asset_type" text,
	"trade_date" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rating" text,
	"error" text,
	"agents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reports" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb,
	"report_html" text,
	"report_dir" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_created_at_idx" ON "analyses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analysis_events_analysis_seq_idx" ON "analysis_events" USING btree ("analysis_id","seq");