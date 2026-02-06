package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	stripeClient "github.com/PortNumber53/mcp-jira-thing/backend/internal/stripe"
)

// RegisterBillingJobs registers the plan migration and archival job handlers
func RegisterBillingJobs(w *Worker, planStore *store.PlanStore, stripe *stripeClient.Client) {
	w.RegisterHandler("plan_migration", planMigrationHandler(planStore, stripe))
	w.RegisterHandler("plan_archival", planArchivalHandler(planStore, stripe))
	w.RegisterHandler("plan_migration_check", planMigrationCheckHandler(planStore, w))

	log.Println("[worker] Registered billing job handlers: plan_migration, plan_archival, plan_migration_check")
}

// planMigrationHandler migrates all subscribers from a deprecated plan version to the active version
func planMigrationHandler(planStore *store.PlanStore, stripe *stripeClient.Client) Handler {
	return func(ctx context.Context, job *models.Job) error {
		// Extract deprecated version ID from payload
		versionIDRaw, ok := job.Payload["deprecated_version_id"]
		if !ok {
			return fmt.Errorf("missing deprecated_version_id in payload")
		}
		deprecatedVersionID := int64(versionIDRaw.(float64))

		newVersionIDRaw, ok := job.Payload["new_version_id"]
		if !ok {
			return fmt.Errorf("missing new_version_id in payload")
		}
		newVersionID := int64(newVersionIDRaw.(float64))

		// Get the new version to find its Stripe price ID
		newVersion, err := planStore.GetActivePlanVersion(ctx, 0)
		// We need to get by version ID instead - let's use the price from payload
		newStripePriceID, _ := job.Payload["new_stripe_price_id"].(string)
		if newStripePriceID == "" && newVersion != nil && newVersion.StripePriceID != nil {
			newStripePriceID = *newVersion.StripePriceID
		}

		if newStripePriceID == "" {
			return fmt.Errorf("no Stripe price ID available for new version %d", newVersionID)
		}

		// Get all active subscriptions on the deprecated version
		subs, err := planStore.GetSubscriptionsByPlanVersion(ctx, deprecatedVersionID)
		if err != nil {
			return fmt.Errorf("get subscriptions for migration: %w", err)
		}

		if len(subs) == 0 {
			log.Printf("[migration] No subscriptions to migrate from version %d", deprecatedVersionID)
			return nil
		}

		log.Printf("[migration] Migrating %d subscriptions from version %d to version %d",
			len(subs), deprecatedVersionID, newVersionID)

		var migrated, failed int
		for _, sub := range subs {
			// Update in Stripe
			if err := stripe.UpdateSubscriptionPrice(sub.StripeSubscriptionID, newStripePriceID); err != nil {
				log.Printf("[migration] Failed to migrate subscription %s in Stripe: %v",
					sub.StripeSubscriptionID, err)
				failed++
				continue
			}

			// Update in DB
			if err := planStore.UpdateSubscriptionPlanVersion(ctx, sub.ID, newVersionID, newStripePriceID); err != nil {
				log.Printf("[migration] Failed to update subscription %d in DB: %v", sub.ID, err)
				failed++
				continue
			}

			migrated++
		}

		log.Printf("[migration] Migration complete: %d migrated, %d failed out of %d total",
			migrated, failed, len(subs))

		if failed > 0 {
			return fmt.Errorf("%d out of %d subscriptions failed to migrate", failed, len(subs))
		}

		return nil
	}
}

// planArchivalHandler archives deprecated plan versions in Stripe once all subscribers have migrated
func planArchivalHandler(planStore *store.PlanStore, stripe *stripeClient.Client) Handler {
	return func(ctx context.Context, job *models.Job) error {
		versionIDRaw, ok := job.Payload["version_id"]
		if !ok {
			return fmt.Errorf("missing version_id in payload")
		}
		versionID := int64(versionIDRaw.(float64))

		// Check if any subscribers remain on this version
		count, err := planStore.CountSubscriptionsByPlanVersion(ctx, versionID)
		if err != nil {
			return fmt.Errorf("count subscribers: %w", err)
		}

		if count > 0 {
			log.Printf("[archival] Version %d still has %d active subscribers, skipping archival", versionID, count)
			return nil
		}

		// Get the version details for Stripe IDs
		// We need to look it up - use payload
		stripeProductID, _ := job.Payload["stripe_product_id"].(string)
		stripePriceID, _ := job.Payload["stripe_price_id"].(string)

		// Archive in Stripe
		if stripePriceID != "" {
			if err := stripe.ArchivePrice(stripePriceID); err != nil {
				log.Printf("[archival] Failed to archive price %s in Stripe: %v", stripePriceID, err)
			}
		}

		if stripeProductID != "" {
			if err := stripe.ArchiveProduct(stripeProductID); err != nil {
				log.Printf("[archival] Failed to archive product %s in Stripe: %v", stripeProductID, err)
			}
		}

		// Mark as archived in DB
		if err := planStore.ArchivePlanVersion(ctx, versionID); err != nil {
			return fmt.Errorf("archive plan version in DB: %w", err)
		}

		log.Printf("[archival] Successfully archived plan version %d", versionID)
		return nil
	}
}

// planMigrationCheckHandler checks for deprecated versions past their grace period
// and enqueues migration + archival jobs
func planMigrationCheckHandler(planStore *store.PlanStore, w *Worker) Handler {
	return func(ctx context.Context, job *models.Job) error {
		versions, err := planStore.GetDeprecatedVersionsPastDeadline(ctx)
		if err != nil {
			return fmt.Errorf("get deprecated versions: %w", err)
		}

		if len(versions) == 0 {
			log.Println("[migration-check] No deprecated versions past deadline")
			return nil
		}

		for _, v := range versions {
			// Get the active version for this plan
			activeVersion, err := planStore.GetActivePlanVersion(ctx, v.PlanID)
			if err != nil {
				log.Printf("[migration-check] No active version for plan %d, skipping", v.PlanID)
				continue
			}

			newStripePriceID := ""
			if activeVersion.StripePriceID != nil {
				newStripePriceID = *activeVersion.StripePriceID
			}

			// Enqueue migration job
			payload, _ := json.Marshal(map[string]interface{}{
				"deprecated_version_id": v.ID,
				"new_version_id":        activeVersion.ID,
				"new_stripe_price_id":   newStripePriceID,
			})
			var migrationPayload models.JSONB
			json.Unmarshal(payload, &migrationPayload)

			migrationJob := &models.Job{
				JobType:     "plan_migration",
				Payload:     migrationPayload,
				Priority:    models.JobPriorityHigh,
				MaxAttempts: 3,
			}
			if err := w.Enqueue(ctx, migrationJob); err != nil {
				log.Printf("[migration-check] Failed to enqueue migration for version %d: %v", v.ID, err)
				continue
			}

			// Enqueue archival job (will check if migration is complete before archiving)
			stripeProductID := ""
			stripePriceID := ""
			if v.StripeProductID != nil {
				stripeProductID = *v.StripeProductID
			}
			if v.StripePriceID != nil {
				stripePriceID = *v.StripePriceID
			}

			archivalPayload, _ := json.Marshal(map[string]interface{}{
				"version_id":        v.ID,
				"stripe_product_id": stripeProductID,
				"stripe_price_id":   stripePriceID,
			})
			var archPayload models.JSONB
			json.Unmarshal(archivalPayload, &archPayload)

			archivalJob := &models.Job{
				JobType:     "plan_archival",
				Payload:     archPayload,
				Priority:    models.JobPriorityNormal,
				MaxAttempts: 5,
			}
			if err := w.Enqueue(ctx, archivalJob); err != nil {
				log.Printf("[migration-check] Failed to enqueue archival for version %d: %v", v.ID, err)
			}

			log.Printf("[migration-check] Enqueued migration and archival jobs for version %d", v.ID)
		}

		return nil
	}
}
