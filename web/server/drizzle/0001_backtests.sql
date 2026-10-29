ALTER TABLE "analyses" ADD COLUMN "kind" text DEFAULT 'analysis' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "result" jsonb;--> statement-breakpoint
CREATE INDEX "analyses_kind_ticker_idx" ON "analyses" USING btree ("kind","ticker");