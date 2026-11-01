CREATE TABLE "status_days" (
	"day" text NOT NULL,
	"component" text NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "status_days_day_component_idx" ON "status_days" USING btree ("day","component");