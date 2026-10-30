CREATE TABLE "watch_runs" (
	"day" text PRIMARY KEY NOT NULL,
	"analysis_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"symbol" text PRIMARY KEY NOT NULL,
	"tv_symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
