ALTER TABLE "fragrance" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fragrance" ADD CONSTRAINT "fragrance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fragrance_user_id_idx" ON "fragrance" USING btree ("user_id");