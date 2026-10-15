CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded');--> statement-breakpoint
CREATE TABLE "mock_provider_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"payment_reference" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_provider_refunds_refund_id_unique" UNIQUE("refund_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"merchant" text NOT NULL,
	"card_brand" text NOT NULL,
	"card_last4" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payments_card_last4_only" CHECK ("payments"."card_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_pence" > 0),
	CONSTRAINT "payments_refund_within_amount" CHECK ("payments"."refunded_pence" >= 0 and "payments"."refunded_pence" <= "payments"."amount_pence"),
	CONSTRAINT "payments_currency_gbp" CHECK ("payments"."currency" = 'GBP')
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"requires_approval" boolean NOT NULL,
	"approval_request_id" uuid,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_refund_id" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_pence" > 0),
	CONSTRAINT "refunds_reason_present" CHECK (length(btrim("refunds"."reason")) > 0),
	CONSTRAINT "refunds_approval_link" CHECK ("refunds"."requires_approval" = ("refunds"."approval_request_id" is not null)),
	CONSTRAINT "refunds_succeeded_has_provider_ref" CHECK (("refunds"."status" = 'succeeded') = ("refunds"."provider_refund_id" is not null and "refunds"."processed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_captured_at_idx" ON "payments" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_approval_request_id_idx" ON "refunds" USING btree ("approval_request_id");