import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261126075834 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "attribute" ("id" text not null, "code" text not null, "name" text not null, "data_type" text check ("data_type" in ('text', 'number', 'boolean', 'select', 'multi_select')) not null default 'text', "filter_type" text check ("filter_type" in ('checkbox', 'select', 'radio', 'range', 'color', 'boolean')) not null default 'checkbox', "unit" text null, "filterable" boolean not null default true, "searchable" boolean not null default true, "position" integer not null default 0, "option_title" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "attribute_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_attribute_deleted_at" ON "attribute" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "attribute_code_unique" ON "attribute" ("code") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "attribute_option" ("id" text not null, "attribute_id" text not null, "value" text not null, "label" text not null, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "attribute_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_attribute_option_deleted_at" ON "attribute_option" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "attribute_option_value_unique" ON "attribute_option" ("attribute_id", "value") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "category_attribute" ("id" text not null, "category_id" text not null, "attribute_id" text not null, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "category_attribute_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_attribute_deleted_at" ON "category_attribute" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "category_attribute_unique" ON "category_attribute" ("category_id", "attribute_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_attribute_value" ("id" text not null, "attribute_id" text not null, "product_id" text not null, "variant_id" text null, "text_value" text null, "numeric_value" real null, "boolean_value" boolean null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_attribute_value_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_attribute_value_deleted_at" ON "product_attribute_value" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "product_attribute_value_lookup" ON "product_attribute_value" ("product_id", "attribute_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "product_attribute_value_attribute_idx" ON "product_attribute_value" ("attribute_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "attribute" cascade;`);

    this.addSql(`drop table if exists "attribute_option" cascade;`);

    this.addSql(`drop table if exists "category_attribute" cascade;`);

    this.addSql(`drop table if exists "product_attribute_value" cascade;`);
  }

}
