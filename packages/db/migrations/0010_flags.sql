CREATE TYPE "public"."flag_change_status" AS ENUM('pending', 'applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."flag_environment" AS ENUM('dev', 'staging', 'prod');--> statement-breakpoint
CREATE TABLE "flag_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flag_id" uuid NOT NULL,
	"environment" "flag_environment" NOT NULL,
	"before_enabled" boolean NOT NULL,
	"before_rollout_percentage" integer NOT NULL,
	"after_enabled" boolean NOT NULL,
	"after_rollout_percentage" integer NOT NULL,
	"base_version" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "flag_change_status" DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "flag_changes_prod_only" CHECK ("flag_changes"."environment" = 'prod'),
	CONSTRAINT "flag_changes_rollout_range" CHECK ("flag_changes"."after_rollout_percentage" between 0 and 100 and "flag_changes"."before_rollout_percentage" between 0 and 100),
	CONSTRAINT "flag_changes_reason_present" CHECK (length(btrim("flag_changes"."reason")) > 0),
	CONSTRAINT "flag_changes_decided_at" CHECK (("flag_changes"."status" = 'pending') = ("flag_changes"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "flag_values" (
	"flag_id" uuid NOT NULL,
	"environment" "flag_environment" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "flag_values_flag_id_environment_pk" PRIMARY KEY("flag_id","environment"),
	CONSTRAINT "flag_values_rollout_range" CHECK ("flag_values"."rollout_percentage" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flags_key_unique" UNIQUE("key"),
	CONSTRAINT "flags_key_format" CHECK ("flags"."key" ~ '^[a-z][a-z0-9-]{1,62}$')
);
--> statement-breakpoint
ALTER TABLE "flag_changes" ADD CONSTRAINT "flag_changes_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_changes" ADD CONSTRAINT "flag_changes_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_changes" ADD CONSTRAINT "flag_changes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_values" ADD CONSTRAINT "flag_values_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_values" ADD CONSTRAINT "flag_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flag_changes_approval_request_id_idx" ON "flag_changes" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flag_changes_one_pending_idx" ON "flag_changes" USING btree ("flag_id","environment") WHERE "flag_changes"."status" = 'pending';