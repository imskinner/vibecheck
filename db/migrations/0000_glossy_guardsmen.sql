CREATE TABLE "assumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"report_id" text,
	"statement" text NOT NULL,
	"category" text NOT NULL,
	"origin" text NOT NULL,
	"impact" integer NOT NULL,
	"uncertainty" integer NOT NULL,
	"test_cost" integer NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"falsification_criterion" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assumptions_impact_range" CHECK ("assumptions"."impact" between 1 and 5),
	CONSTRAINT "assumptions_uncertainty_range" CHECK ("assumptions"."uncertainty" between 1 and 5),
	CONSTRAINT "assumptions_test_cost_range" CHECK ("assumptions"."test_cost" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"assumption_id" text NOT NULL,
	"adapter_id" text,
	"text" text NOT NULL,
	"stance" text NOT NULL,
	"source_url" text,
	"source_type" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"retrieved_text" text,
	"confidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_require_source_url" CHECK ("claims"."source_type" in ('primary_conversation', 'model_inference') or "claims"."source_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"input_type" text NOT NULL,
	"raw_input" text NOT NULL,
	"canvas" jsonb,
	"canvas_confirmed_at" timestamp with time zone,
	"t0" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"canvas_snapshot" jsonb NOT NULL,
	"adapter_set" jsonb NOT NULL,
	"prompt_versions" jsonb NOT NULL,
	"model_ids" jsonb NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL,
	"report_id" text,
	"prior_snapshot_id" text,
	"sub_scores" jsonb NOT NULL,
	"evidence_quality" double precision NOT NULL,
	"weighted_mean" double precision NOT NULL,
	"cap" double precision NOT NULL,
	"cap_binding" boolean NOT NULL,
	"composite" double precision NOT NULL,
	"claim_ids" jsonb NOT NULL,
	"movement" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_assumption_id_assumptions_id_fk" FOREIGN KEY ("assumption_id") REFERENCES "public"."assumptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assumptions_idea_idx" ON "assumptions" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "claims_assumption_idx" ON "claims" USING btree ("assumption_id");--> statement-breakpoint
CREATE INDEX "reports_idea_idx" ON "reports" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "score_snapshots_idea_idx" ON "score_snapshots" USING btree ("idea_id");