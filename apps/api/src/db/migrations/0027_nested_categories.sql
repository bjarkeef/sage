ALTER TABLE "category" DROP CONSTRAINT "category_portfolio_name";--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_portfolio_root_name_idx" ON "category" USING btree ("portfolio_id","name") WHERE "category"."parent_id" is null;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_portfolio_parent_name" UNIQUE("portfolio_id","parent_id","name");