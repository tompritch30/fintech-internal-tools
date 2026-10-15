CREATE TYPE "public"."kyc_case_status" AS ENUM('open', 'in_review', 'pending_approval', 'escalated', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_risk_rating" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "kyc_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"applicant_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"id_number" text NOT NULL,
	"address" text NOT NULL,
	"nationality" text NOT NULL,
	"risk_rating" "kyc_risk_rating" NOT NULL,
	"sanctions_hit" boolean DEFAULT false NOT NULL,
	"pep" boolean DEFAULT false NOT NULL,
	"status" "kyc_case_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"claimed_at" timestamp with time zone,
	"decision_note" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"retention_until" timestamp with time zone,
	CONSTRAINT "kyc_cases_reference_unique" UNIQUE("reference"),
	CONSTRAINT "kyc_cases_owner_matches_status" CHECK (("kyc_cases"."status" in ('open', 'escalated')) = ("kyc_cases"."owner_id" is null)),
	CONSTRAINT "kyc_cases_claimed_at_with_owner" CHECK (("kyc_cases"."owner_id" is null) = ("kyc_cases"."claimed_at" is null)),
	CONSTRAINT "kyc_cases_closed_has_retention" CHECK (("kyc_cases"."status" in ('approved', 'rejected')) = ("kyc_cases"."closed_at" is not null and "kyc_cases"."retention_until" is not null)),
	CONSTRAINT "kyc_cases_retention_at_least_5_years" CHECK ("kyc_cases"."retention_until" is null or "kyc_cases"."retention_until" >= "kyc_cases"."closed_at" + interval '5 years'),
	CONSTRAINT "kyc_cases_rejection_has_note" CHECK ("kyc_cases"."status" <> 'rejected' or length(btrim(coalesce("kyc_cases"."decision_note", ''))) > 0),
	CONSTRAINT "kyc_cases_nationality_code" CHECK ("kyc_cases"."nationality" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_documents_kind" CHECK ("kyc_documents"."kind" in ('passport', 'driving_licence', 'utility_bill', 'bank_statement'))
);
--> statement-breakpoint
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_case_id_kyc_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."kyc_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_cases_status_idx" ON "kyc_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_cases_owner_id_idx" ON "kyc_cases" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "kyc_documents_case_id_idx" ON "kyc_documents" USING btree ("case_id");