CREATE TYPE "public"."identity_provider" AS ENUM('linkedin', 'instagram', 'x');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('mutual', 'follower', 'following');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_profiles" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"default_query" text DEFAULT 'Founders, CEOs and business owners' NOT NULL,
	"social_platforms" text[] DEFAULT '{"x","instagram","linkedin"}' NOT NULL,
	"social_max_per_list" integer DEFAULT 200 NOT NULL,
	"social_mutual_only" boolean DEFAULT true NOT NULL,
	"search_budget_micro" integer DEFAULT 100000 NOT NULL,
	"blocked_countries" text[] DEFAULT '{}' NOT NULL,
	"allowed_countries" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"size" text,
	"location" text,
	"is_client" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"name" text,
	"title" text,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_id" text NOT NULL,
	"handle" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"target_person_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"strength_score" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"object_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid,
	"company_id" uuid,
	"provider" text DEFAULT 'treg' NOT NULL,
	"tool_id" text NOT NULL,
	"served_by" text,
	"treg_call_id" text,
	"cost_micro" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"source_object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"query_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"score" integer NOT NULL,
	"confidence" text DEFAULT 'low' NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"query_hash" text NOT NULL,
	"query" text NOT NULL,
	"brief" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "person_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "person_identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_edges" ADD CONSTRAINT "relationship_edges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_edges" ADD CONSTRAINT "relationship_edges_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_edges" ADD CONSTRAINT "relationship_edges_target_person_id_people_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_objects" ADD CONSTRAINT "source_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_calls" ADD CONSTRAINT "enrichment_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_calls" ADD CONSTRAINT "enrichment_calls_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_calls" ADD CONSTRAINT "enrichment_calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_calls" ADD CONSTRAINT "enrichment_calls_source_object_id_source_objects_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "public"."source_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_scores" ADD CONSTRAINT "fit_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_scores" ADD CONSTRAINT "fit_scores_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_briefs" ADD CONSTRAINT "search_briefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_companies_tenant_name" ON "companies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_companies_tenant_domain" ON "companies" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE INDEX "idx_people_tenant_company" ON "people" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "idx_people_tenant_name" ON "people" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_person_identity_provider" ON "person_identities" USING btree ("tenant_id","provider","provider_id");--> statement-breakpoint
CREATE INDEX "idx_person_identities_person" ON "person_identities" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "idx_relation_owner" ON "relationship_edges" USING btree ("tenant_id","owner_person_id");--> statement-breakpoint
CREATE INDEX "idx_relation_target" ON "relationship_edges" USING btree ("tenant_id","target_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_relation_edge" ON "relationship_edges" USING btree ("tenant_id","owner_person_id","target_person_id","platform","relationship_type");--> statement-breakpoint
CREATE INDEX "idx_source_objects_tenant" ON "source_objects" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_objects_provider" ON "source_objects" USING btree ("tenant_id","provider","provider_id");--> statement-breakpoint
CREATE INDEX "idx_enrichment_calls_tenant_created" ON "enrichment_calls" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_calls_tenant_person" ON "enrichment_calls" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fit_scores_person_query" ON "fit_scores" USING btree ("tenant_id","person_id","query_hash");--> statement-breakpoint
CREATE INDEX "idx_fit_scores_query" ON "fit_scores" USING btree ("tenant_id","query_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_search_briefs_query" ON "search_briefs" USING btree ("tenant_id","query_hash");