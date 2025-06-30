import { JiraClientCore } from './core';

interface JiraPaginatedProjectsResponse {
  values: any[];
  isLast?: boolean;
  total?: number;
  // Add other properties if needed, like startAt, maxResults
}

/**
 * Payload for creating a new Jira project
 *
 * @remarks
 * Required fields:
 * - key: Must be uppercase, unique, and contain only letters and numbers
 * - name: Name of the project
 * - projectTypeKey: Type of project (e.g., 'software', 'business', 'service_desk')
 * - leadAccountId: Account ID of the project lead (REQUIRED - will cause 400 error if missing)
 *
 * Optional fields that may be required depending on your Jira configuration:
 * - projectTemplateKey: Template key for the project
 */
export interface JiraProjectCreatePayload {
  /** Project key - must be uppercase, unique, and contain only letters and numbers */
  key: string;
  /** Name of the project */
  name: string;
  /** Type of project (e.g., 'software', 'business', 'service_desk') */
  projectTypeKey: string;
  /** Account ID of the project lead - REQUIRED by Jira API */
  leadAccountId: string; // Changed to required
  /** Project description */
  description?: string;
  /** Project URL */
  url?: string;
  /** Assignee type (e.g., 'PROJECT_LEAD', 'UNASSIGNED') */
  assigneeType?: string;
  /** Avatar ID */
  avatarId?: number;
  /** Issue security scheme ID */
  issueSecurityScheme?: number;
  /** Permission scheme ID */
  permissionScheme?: number;
  /** Notification scheme ID */
  notificationScheme?: number;
  /** Category ID */
  categoryId?: number;
  /** Project template key */
  projectTemplateKey?: string;
  /** Workflow scheme ID */
  workflowScheme?: number;
}

export class JiraProjects extends JiraClientCore {
  public async getProjects(): Promise<any[]> {
    console.log('about to call Jira API for all paginated projects');
    let allProjects: any[] = [];
    let startAt = 0;
    const maxResults = 50; // Jira API default/max is often 50 or 100
    let isLastPage = false;

    while (!isLastPage) {
      const result: JiraPaginatedProjectsResponse = await this.makeRequest(`/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}`);
      console.log(`Raw paginated result (startAt: ${startAt}):`, result);

      if (result && Array.isArray(result.values)) {
        allProjects = allProjects.concat(result.values);
        // Check if this is the last page based on total and maxResults
        // Jira's API usually provides total and isLast flag
        if (result.isLast || (result.total !== undefined && allProjects.length >= result.total)) {
          isLastPage = true;
        } else {
          startAt += maxResults;
        }
      } else {
        // No more projects or unexpected response format
        isLastPage = true;
      }
    }
    return allProjects;
  }

  /**
   * Creates a new Jira project
   * @param payload The project creation payload
   * @returns The created project data
   */
  public async createProject(payload: JiraProjectCreatePayload): Promise<any> {
    console.log('Creating new Jira project:', payload.name);
    return this.makeRequest('/rest/api/3/project', 'POST', payload);
  }

  /**
   * Gets a single project by its ID or key
   * @param projectIdOrKey The project ID or key
   * @param expand Optional comma-separated list of properties to expand
   * @returns The project data
   */
  public async getProject(projectIdOrKey: string, expand?: string): Promise<any> {
    const endpoint = `/rest/api/3/project/${projectIdOrKey}${expand ? `?expand=${expand}` : ''}`;
    return this.makeRequest(endpoint);
  }
}
