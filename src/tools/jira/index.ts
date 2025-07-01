import { 
  JiraIssueFields, 
  JiraIssue, 
  JiraIssueSearchResult, 
  CreateUserPayload, 
  JiraUser, 
  JiraSprint, 
  CreateSprintPayload, 
  UpdateSprintPayload,
  JiraIssueType,
  CreateIssueTypePayload,
  UpdateIssueTypePayload
} from './interfaces';
import { JiraClientCore } from './client/core';
import { JiraIssues } from './client/issues';
import { JiraSprints } from './client/sprints';
import { JiraProjects, JiraProjectCreatePayload } from './client/projects';
import { JiraUsers } from './client/users';
import { JiraIssueTypes } from './client/issuetypes';
import { JiraProject } from './interfaces';
import { parseLabels } from './utils';

export class JiraClient extends JiraClientCore {
  private issues: JiraIssues;
  private sprints: JiraSprints;
  private projects: JiraProjects;
  private users: JiraUsers;
  private issueTypes: JiraIssueTypes;

  constructor(env: Env) {
    super(env);
    this.issues = new JiraIssues(env);
    this.sprints = new JiraSprints(env);
    this.projects = new JiraProjects(env);
    this.users = new JiraUsers(env);
    this.issueTypes = new JiraIssueTypes(env);
  }

  // Epic CRUD operations
  public async createEpic(projectKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const fields: JiraIssueFields = {
      project: { key: projectKey },
      summary: summary,
      issuetype: { name: 'Epic' }, // Assuming 'Epic' is the issue type name for Epics
      description: description ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
    };
    return this.issues.createIssue(fields);
  }

  public async getEpic(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async getProjects(): Promise<JiraProject[]> {
    console.log('inside getProjects function');
    return this.projects.getProjects();
  }

  public async updateEpic(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteEpic(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Task CRUD operations
  public async createTask(projectKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const fields: JiraIssueFields = {
      project: { key: projectKey },
      summary: summary,
      issuetype: { name: 'Task' }, // Assuming 'Task' is the issue type name for Tasks
      description: description ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
    };
    return this.issues.createIssue(fields);
  }

  public async getTask(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async updateTask(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteTask(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Subtask CRUD operations
  public async createSubtask(parentIssueKey: string, projectKey: string, summary: string, description?: string, issueType?: string): Promise<JiraIssue> {
    try {
      // Validate parent issue exists first
      const parentIssue = await this.issues.getIssue(parentIssueKey).catch(error => {
        throw new Error(`Invalid parent issue key: ${parentIssueKey}. ${error.message || 'Parent issue not found.'}`); 
      });
      
      // Get the parent issue's project key if available - this is more reliable than the provided projectKey
      const parentProjectKey = parentIssue.fields?.project?.key || projectKey;
      if (parentProjectKey !== projectKey) {
        console.warn(`Parent issue ${parentIssueKey} belongs to project ${parentProjectKey}, not ${projectKey}. Using parent's project.`);
      }
      
      // Get available issue types with a focus on subtask types
      const issueTypes = await this.projects.getProjectIssueTypes(parentProjectKey).catch((error) => {
        console.warn(`Could not get issue types: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return [];
      });
      
      // Define a type that can have either id or name
      type IssueTypeIdentifier = { id: string } | { name: string };
      
      // Try multiple approaches to find a valid subtask type
      let subtaskType: IssueTypeIdentifier;
      
      // If issueType is provided, use it directly
      if (issueType) {
        // Check if it's an ID (numeric) or a name
        if (/^\d+$/.test(issueType)) {
          subtaskType = { id: issueType };
          console.log(`Using provided subtask type ID: ${issueType}`);
        } else {
          subtaskType = { name: issueType };
          console.log(`Using provided subtask type name: ${issueType}`);
        }
      }
      // Otherwise use automatic detection
      else {
        // Approach 1: Look for a type with subtask=true
        const subtaskIssueType = issueTypes.find(type => type && type.subtask === true);
        if (subtaskIssueType && subtaskIssueType.id) {
          subtaskType = { id: subtaskIssueType.id };
          console.log(`Using subtask type ID: ${subtaskIssueType.id} (${subtaskIssueType.name || 'unnamed'})`);
        } 
        // Approach 2: Look for a type with 'subtask' in the name (case insensitive)
        else {
          const subtaskByName = issueTypes.find(type => 
            type && type.name && type.name.toLowerCase().includes('subtask'));
            
          if (subtaskByName && subtaskByName.id) {
            subtaskType = { id: subtaskByName.id };
            console.log(`Using subtask type by name: ${subtaskByName.id} (${subtaskByName.name})`);
          }
          // Approach 3: Fall back to the default name 'Sub-task' (common in many Jira instances)
          else {
            // Try both 'Subtask' and 'Sub-task' as these are common in different Jira versions
            subtaskType = { name: 'Sub-task' };
            console.warn(`No subtask type found. Trying with name 'Sub-task'.`);
          }
        }
      }
      
      // Create fields object for the new subtask
      const fields: any = {
        project: { key: parentProjectKey }, // Always use the parent's project
        summary: summary,
        issuetype: subtaskType,
        parent: { key: parentIssueKey },
        description: description ? { 
          type: 'doc', 
          version: 1, 
          content: [{ 
            type: 'paragraph', 
            content: [{ type: 'text', text: description }] 
          }] 
        } : undefined,
      };
      
      // Create the subtask
      return this.issues.createIssue(fields);
    } catch (error: any) {
      // Enhance error message with more helpful information
      const errorMsg = error?.message || 'Unknown error creating subtask';
      
      if (errorMsg.includes('issuetype')) {
        throw new Error(
          `Issue type error: The project may not support subtasks or the subtask type name may be different in your Jira instance. ` +
          `Common subtask type names are 'Subtask', 'Sub-task', or 'Sub Task'. ` +
          `Original error: ${errorMsg}`
        );
      } else if (errorMsg.includes('parent')) {
        throw new Error(`Parent issue error: ${errorMsg}. Ensure the parent issue exists and can have subtasks.`);
      } else if (errorMsg.includes('project')) {
        throw new Error(`Project error: ${errorMsg}. Ensure the project exists and supports subtasks.`);
      } else {
        throw new Error(`Error creating subtask: ${errorMsg}`);
      }
    }
  }

  public async getSubtask(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async updateSubtask(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteSubtask(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Label (Tag) management operations
  public async addLabels(issueIdOrKey: string, labelsToAdd: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're not adding brackets or quotes
    const sanitizedLabels = parseLabels(labelsToAdd);
    
    const issue = await this.issues.getIssue(issueIdOrKey);
    const currentLabels = issue.fields.labels || [];
    const newLabels = Array.from(new Set([...currentLabels, ...sanitizedLabels]));
    return this.issues.updateIssue(issueIdOrKey, { labels: newLabels });
  }

  public async removeLabels(issueIdOrKey: string, labelsToRemove: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're removing the right labels
    const sanitizedLabels = parseLabels(labelsToRemove);
    
    const issue = await this.issues.getIssue(issueIdOrKey);
    const currentLabels = issue.fields.labels || [];
    const newLabels = currentLabels.filter(label => !sanitizedLabels.includes(label));
    return this.issues.updateIssue(issueIdOrKey, { labels: newLabels });
  }

  public async getLabelsForIssue(issueIdOrKey: string): Promise<string[]> {
    const issue = await this.issues.getIssue(issueIdOrKey);
    return issue.fields.labels || [];
  }

  public async setLabels(issueIdOrKey: string, labels: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're setting the right labels
    const sanitizedLabels = parseLabels(labels);
    return this.issues.updateIssue(issueIdOrKey, { labels: sanitizedLabels });
  }

  /**
   * Get details of a Jira issue by ID or key
   * @param issueIdOrKey The ID or key of the issue to retrieve
   * @returns Promise resolving to the issue details
   */
  public async getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  /**
   * Update any field on a Jira issue
   * @param issueIdOrKey The ID or key of the issue to update
   * @param fields Object containing the fields to update
   * @returns Promise resolving when the update is complete
   */
  public async updateIssue(issueIdOrKey: string, fields: Record<string, any>): Promise<void> {
    // Convert simple text description to Jira's document format if needed
    if (fields.description && typeof fields.description === 'string') {
      fields.description = { 
        type: 'doc', 
        version: 1, 
        content: [{ 
          type: 'paragraph', 
          content: [{ type: 'text', text: fields.description }] 
        }] 
      };
    }
    
    // Format the fields object as expected by the Jira API
    const formattedFields: Partial<JiraIssueFields> = {};
    
    // Use type assertion to handle dynamic field assignment
    Object.keys(fields).forEach(key => {
      (formattedFields as any)[key] = fields[key];
    });
    
    return this.issues.updateIssue(issueIdOrKey, formattedFields);
  }

  // User management operations
  public async getUser(accountId: string): Promise<JiraUser> {
    return this.users.getUser(accountId);
  }

  public async createUser(payload: CreateUserPayload): Promise<JiraUser> {
    return this.users.createUser(payload);
  }

  public async deleteUser(accountId: string): Promise<void> {
    return this.users.deleteUser(accountId);
  }

  // Sprint management operations
  public async createSprint(payload: CreateSprintPayload): Promise<JiraSprint> {
    return this.sprints.createSprint(payload);
  }

  public async getSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.getSprint(sprintId);
  }

  public async updateSprint(sprintId: number, payload: Partial<UpdateSprintPayload>): Promise<JiraSprint> {
    return this.sprints.updateSprint(sprintId, payload);
  }

  public async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssueSearchResult> {
    return this.issues.searchIssues(jql, maxResults);
  }

  public async deleteSprint(sprintId: number): Promise<void> {
    return this.sprints.deleteSprint(sprintId);
  }

  public async startSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.startSprint(sprintId);
  }

  public async completeSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.completeSprint(sprintId);
  }

  public async getSprintsForBoard(boardId: number): Promise<JiraSprint[]> {
    return this.sprints.getSprintsForBoard(boardId);
  }

  public async getIssuesForSprint(sprintId: number): Promise<JiraIssue[]> {
    return this.sprints.getIssuesForSprint(sprintId);
  }

  public async moveIssuesToSprint(sprintId: number, issueIdsOrKeys: string[]): Promise<void> {
    return this.sprints.moveIssuesToSprint(sprintId, issueIdsOrKeys);
  }

  public async moveIssuesToBacklog(boardId: number, issueIdsOrKeys: string[]): Promise<void> {
    return this.sprints.moveIssuesToBacklog(boardId, issueIdsOrKeys);
  }

  // Project management operations
  public async createProject(payload: JiraProjectCreatePayload): Promise<JiraProject> {
    return this.projects.createProject(payload);
  }

  public async getProject(projectIdOrKey: string, expand?: string): Promise<JiraProject> {
    return this.projects.getProject(projectIdOrKey, expand);
  }
  
  public async getProjectIssueTypes(projectIdOrKey: string): Promise<any[]> {
    return this.projects.getProjectIssueTypes(projectIdOrKey);
  }

  /**
   * Search for Jira users by query string
   * @param query Search query (username, display name, or email)
   * @returns Array of user objects with account IDs
   */
  public async searchUsers(query: string): Promise<any[]> {
    return this.makeRequest<any[]>(`/rest/api/3/user/search?query=${encodeURIComponent(query)}`, 'GET');
  }

  /**
   * Get available transitions for a Jira issue
   * @param issueIdOrKey ID or key of the issue to get transitions for
   * @returns Promise resolving to the transitions response
   */
  public async getTransitions(issueIdOrKey: string): Promise<any> {
    return this.issues.getTransitions(issueIdOrKey);
  }

  /**
   * Perform a transition on a Jira issue to change its status
   * @param issueIdOrKey ID or key of the issue to transition
   * @param transitionId ID of the transition to perform
   * @param comment Optional comment to add when performing the transition
   * @returns Promise resolving when the transition is complete
   */
  public async doTransition(issueIdOrKey: string, transitionId: string, comment?: string): Promise<void> {
    return this.issues.doTransition(issueIdOrKey, transitionId, comment);
  }

  /**
   * Get all issue types available to the user
   * @returns Promise resolving to an array of issue types
   */
  public async getAllIssueTypes(): Promise<JiraIssueType[]> {
    return this.issueTypes.getAllIssueTypes();
  }

  /**
   * Create a new issue type
   * @param payload The issue type creation payload
   * @returns Promise resolving to the created issue type
   */
  public async createIssueType(payload: CreateIssueTypePayload): Promise<JiraIssueType> {
    return this.issueTypes.createIssueType(payload);
  }

  /**
   * Get issue types for a specific project
   * @param projectId The ID of the project
   * @returns Promise resolving to an array of issue types
   */
  public async getIssueTypesForProject(projectId: string): Promise<JiraIssueType[]> {
    return this.issueTypes.getIssueTypesForProject(projectId);
  }

  /**
   * Get a specific issue type by ID
   * @param issueTypeId The ID of the issue type
   * @returns Promise resolving to the issue type
   */
  public async getIssueType(issueTypeId: string): Promise<JiraIssueType> {
    return this.issueTypes.getIssueType(issueTypeId);
  }

  /**
   * Update an existing issue type
   * @param issueTypeId The ID of the issue type to update
   * @param payload The update payload with fields to modify
   * @returns Promise resolving to the updated issue type
   */
  public async updateIssueType(issueTypeId: string, payload: UpdateIssueTypePayload): Promise<JiraIssueType> {
    return this.issueTypes.updateIssueType(issueTypeId, payload);
  }

  /**
   * Delete an issue type
   * @param issueTypeId The ID of the issue type to delete
   * @param alternativeIssueTypeId Optional ID of an issue type to replace the deleted issue type
   * @returns Promise resolving when the deletion is complete
   */
  public async deleteIssueType(issueTypeId: string, alternativeIssueTypeId?: string): Promise<void> {
    return this.issueTypes.deleteIssueType(issueTypeId, alternativeIssueTypeId);
  }

  /**
   * Get alternative issue types that can be used to replace a specific issue type
   * @param issueTypeId The ID of the issue type
   * @returns Promise resolving to an array of alternative issue types
   */
  public async getAlternativeIssueTypes(issueTypeId: string): Promise<JiraIssueType[]> {
    return this.issueTypes.getAlternativeIssueTypes(issueTypeId);
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
    return this.issueTypes.loadIssueTypeAvatar(issueTypeId, size, avatarData, filename);
  }
}
