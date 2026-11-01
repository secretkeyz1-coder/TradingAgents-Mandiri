CREATE TABLE "indicator_grants" (
	"indicator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"builtin" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"code" text,
	"plans" jsonb DEFAULT '["free","pro","creator"]'::jsonb NOT NULL,
	"default_on" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicators_builtin_unique" UNIQUE("builtin")
);
--> statement-breakpoint
ALTER TABLE "indicator_grants" ADD CONSTRAINT "indicator_grants_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_grants" ADD CONSTRAINT "indicator_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_grants_pair_idx" ON "indicator_grants" USING btree ("indicator_id","user_id");--> statement-breakpoint
CREATE INDEX "indicator_grants_user_idx" ON "indicator_grants" USING btree ("user_id");--> statement-breakpoint
-- The built-in engines, open to every plan and off until a member turns them on: what every account had before the catalog.
INSERT INTO "indicators" ("builtin", "name", "description", "sort_order") VALUES ('scalper', 'Scalper Pro+', 'Sinyal beli dan jual cepat dari arah tren dan momentum.', 1), ('pob', 'PoB BYSTRA', 'Zona tempat harga sering berbalik (SNR, QM, CK2/CK3).', 2), ('fib', 'Fib GZ', 'Area pullback Fibonacci 0,5–0,618 setelah harga bergerak jauh.', 3) ON CONFLICT ("builtin") DO NOTHING;
