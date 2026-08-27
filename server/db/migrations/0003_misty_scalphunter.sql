CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "api_key_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_user_id_idx" ON "api_key" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "api_key" ("id", "user_id", "secret_hash", "expires_at")
SELECT
	'legacy_' || substring(encode(sha256(convert_to("api_key", 'UTF8')), 'hex'), 1, 16),
	"id",
	encode(sha256(convert_to("api_key", 'UTF8')), 'hex'),
	now() + interval '7 days'
FROM "user"
WHERE "api_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "api_key";
