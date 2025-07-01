import { JiraClientCore } from './core';
import { 
  JiraIssueType, 
  CreateIssueTypePayload, 
  UpdateIssueTypePayload 
} from '../interfaces';

/**
 * Client for interacting with Jira Issue Types API endpoints
 */
export class JiraIssueTypes extends JiraClientCore {
  /**
   * Get all issue types available to the user
   * @returns Promise resolving to an array of issue types
   */
  public async getAllIssueTypes(): Promise<JiraIssueType[]> {
    return this.makeRequest<JiraIssueType[]>('/rest/api/3/issuetype');
  }

  /**
   * Create a new issue type
   * @param payload The issue type creation payload
   * @returns Promise resolving to the created issue type
   */
  public async createIssueType(payload: CreateIssueTypePayload): Promise<JiraIssueType> {
    return this.makeRequest<JiraIssueType>('/rest/api/3/issuetype', 'POST', payload);
  }

  /**
   * Get issue types for a specific project
   * @param projectId The ID of the project
   * @returns Promise resolving to an array of issue types
   */
  public async getIssueTypesForProject(projectId: string): Promise<JiraIssueType[]> {
    return this.makeRequest<JiraIssueType[]>(`/rest/api/3/issuetype/project?projectId=${projectId}`);
  }

  /**
   * Get a specific issue type by ID
   * @param issueTypeId The ID of the issue type
   * @returns Promise resolving to the issue type
   */
  public async getIssueType(issueTypeId: string): Promise<JiraIssueType> {
    return this.makeRequest<JiraIssueType>(`/rest/api/3/issuetype/${issueTypeId}`);
  }

  /**
   * Update an existing issue type
   * @param issueTypeId The ID of the issue type to update
   * @param payload The update payload with fields to modify
   * @returns Promise resolving to the updated issue type
   */
  public async updateIssueType(issueTypeId: string, payload: UpdateIssueTypePayload): Promise<JiraIssueType> {
    return this.makeRequest<JiraIssueType>(`/rest/api/3/issuetype/${issueTypeId}`, 'PUT', payload);
  }

  /**
   * Delete an issue type
   * @param issueTypeId The ID of the issue type to delete
   * @param alternativeIssueTypeId Optional ID of an issue type to replace the deleted issue type
   * @returns Promise resolving when the deletion is complete
   */
  public async deleteIssueType(issueTypeId: string, alternativeIssueTypeId?: string): Promise<void> {
    const queryParams = alternativeIssueTypeId ? `?alternativeIssueTypeId=${alternativeIssueTypeId}` : '';
    return this.makeRequest<void>(`/rest/api/3/issuetype/${issueTypeId}${queryParams}`, 'DELETE');
  }

  /**
   * Get alternative issue types that can be used to replace a specific issue type
   * @param issueTypeId The ID of the issue type
   * @returns Promise resolving to an array of alternative issue types
   */
  public async getAlternativeIssueTypes(issueTypeId: string): Promise<JiraIssueType[]> {
    return this.makeRequest<JiraIssueType[]>(`/rest/api/3/issuetype/${issueTypeId}/alternatives`);
  }

  /**
   * Load an avatar for an issue type
   * @param issueTypeId The ID of the issue type
   * @param size The size of the avatar in pixels
   * @param avatarData The avatar image data as a base64 encoded string
   * @param filename The filename of the avatar
   * @returns Promise resolving to the response from the avatar upload
   */
  public async loadIssueTypeAvatar(
    issueTypeId: string, 
    size: number, 
    avatarData: string, 
    filename: string
  ): Promise<any> {
    // This is a multipart form data request, which might need special handling
    // For simplicity, we're using a basic implementation here
    const payload = {
      size,
      filename,
      avatarData
    };
    return this.makeRequest<any>(`/rest/api/3/issuetype/${issueTypeId}/avatar2`, 'POST', payload);
  }
}
