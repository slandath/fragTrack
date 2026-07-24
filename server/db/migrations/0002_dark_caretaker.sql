CREATE TABLE "price" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_url_id" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"scraped_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_retailer_url_id_retailer_url_id_fk" FOREIGN KEY ("retailer_url_id") REFERENCES "public"."retailer_url"("id") ON DELETE cascade ON UPDATE no action;