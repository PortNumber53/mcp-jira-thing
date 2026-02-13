/**
 * Integration modules barrel file.
 *
 * Importing this file causes all integration modules to self-register
 * with the global IntegrationRegistry via their side-effect imports.
 */

export { IntegrationRegistry, integrationRegistry } from "./registry";
export type { IntegrationModule, IntegrationContext, IntegrationStatus } from "./registry";

// Side-effect imports: each module auto-registers on import
import "./slack";
import "./google-docs";
