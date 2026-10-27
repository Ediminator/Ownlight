CREATE TABLE "catalogue_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"category" varchar(32) DEFAULT 'service' NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"tax_rate_basis_points" integer DEFAULT 1900 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_items_slug_unique" UNIQUE("slug"),
	CONSTRAINT "catalogue_items_category_check" CHECK (category IN ('service', 'product', 'travel', 'licensing'))
);
--> statement-breakpoint
CREATE TABLE "package_included_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"project_type_key" varchar(40),
	"base_price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"tax_rate_basis_points" integer DEFAULT 1900 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "tax_number" varchar(50);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "vat_id" varchar(50);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "is_kleinunternehmer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "kleinunternehmer_notice" text;--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "default_tax_rate_basis_points" integer DEFAULT 1900 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "package_included_items" ADD CONSTRAINT "package_included_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_items_is_active_idx" ON "catalogue_items" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "catalogue_items_category_idx" ON "catalogue_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "catalogue_items_position_idx" ON "catalogue_items" USING btree ("position");--> statement-breakpoint
CREATE INDEX "package_included_items_package_id_idx" ON "package_included_items" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_included_items_position_idx" ON "package_included_items" USING btree ("package_id","position");--> statement-breakpoint
CREATE INDEX "packages_is_active_idx" ON "packages" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "packages_position_idx" ON "packages" USING btree ("position");--> statement-breakpoint
CREATE INDEX "packages_project_type_key_idx" ON "packages" USING btree ("project_type_key");