/**
 * Integration Module Registry
 *
 * Provides infrastructure for feature-flag gated third-party integrations.
 * Each integration module registers itself with the registry and is only
 * activated when its corresponding feature flag environment variable is set.
 *
 * Feature flags follow the pattern: INTEGRATION_<NAME>_ENABLED=true
 */

export interface IntegrationContext {
  env: Record<string, unknown>;
  backendBaseUrl: string | undefined;
  userEmail: string | undefined;
}

export interface IntegrationModule {
  /** Unique identifier for this integration (e.g. "slack", "google_docs") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Environment variable that gates this integration (e.g. "INTEGRATION_SLACK_ENABLED") */
  featureFlag: string;
  /** Optional: additional env vars required for this integration to function */
  requiredEnvVars?: string[];
  /** Initialize the integration. Called once when the module is activated. */
  initialize(ctx: IntegrationContext): Promise<void>;
  /** Return the current status of this integration */
  getStatus(ctx: IntegrationContext): Promise<IntegrationStatus>;
  /** Clean up resources when the integration is deactivated */
  teardown?(): Promise<void>;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  error?: string;
}

export class IntegrationRegistry {
  private modules: Map<string, IntegrationModule> = new Map();
  private initialized: Set<string> = new Set();

  /**
   * Register an integration module. Does not activate it — activation
   * happens when `activateAll` is called with an environment that has
   * the module's feature flag set.
   */
  register(module: IntegrationModule): void {
    if (this.modules.has(module.id)) {
      console.warn(`[integrations] Module "${module.id}" is already registered, skipping duplicate.`);
      return;
    }
    this.modules.set(module.id, module);
    console.log(`[integrations] Registered module: ${module.name} (${module.id})`);
  }

  /**
   * Activate all registered modules whose feature flags are enabled
   * in the provided environment.
   */
  async activateAll(ctx: IntegrationContext): Promise<void> {
    for (const [id, module] of this.modules) {
      if (this.initialized.has(id)) continue;

      const flagValue = ctx.env[module.featureFlag];
      const isEnabled = flagValue === true || flagValue === "true" || flagValue === "1";

      if (!isEnabled) {
        console.log(`[integrations] Module "${module.name}" skipped (${module.featureFlag} not set)`);
        continue;
      }

      // Check required env vars
      const missingVars = (module.requiredEnvVars ?? []).filter((v) => !ctx.env[v]);
      if (missingVars.length > 0) {
        console.warn(
          `[integrations] Module "${module.name}" enabled but missing required vars: ${missingVars.join(", ")}`,
        );
        continue;
      }

      try {
        await module.initialize(ctx);
        this.initialized.add(id);
        console.log(`[integrations] Activated module: ${module.name}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[integrations] Failed to activate module "${module.name}": ${msg}`);
      }
    }
  }

  /**
   * Get the status of all registered modules.
   */
  async getStatuses(ctx: IntegrationContext): Promise<IntegrationStatus[]> {
    const statuses: IntegrationStatus[] = [];
    for (const [, module] of this.modules) {
      try {
        const status = await module.getStatus(ctx);
        statuses.push(status);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        statuses.push({
          id: module.id,
          name: module.name,
          enabled: false,
          configured: false,
          error: msg,
        });
      }
    }
    return statuses;
  }

  /**
   * Check if a specific integration is active (enabled + initialized).
   */
  isActive(id: string): boolean {
    return this.initialized.has(id);
  }

  /**
   * Get a registered module by ID.
   */
  getModule(id: string): IntegrationModule | undefined {
    return this.modules.get(id);
  }

  /**
   * List all registered module IDs.
   */
  listModules(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Tear down all active integrations.
   */
  async teardownAll(): Promise<void> {
    for (const id of this.initialized) {
      const module = this.modules.get(id);
      if (module?.teardown) {
        try {
          await module.teardown();
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[integrations] Error tearing down "${module.name}": ${msg}`);
        }
      }
    }
    this.initialized.clear();
  }
}

/** Singleton registry instance shared across the worker */
export const integrationRegistry = new IntegrationRegistry();
