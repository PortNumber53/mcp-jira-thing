import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { JiraClient } from './tools/jira';
import { GitHubHandler } from "./github-handler";
import { parseLabels } from './tools/jira/utils';

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

const ALLOWED_USERNAMES = new Set<string>([
	'PortNumber53',
	// Add GitHub usernames of users who should have access to the image generation tool
	// For example: 'yourusername', 'coworkerusername'
]);

interface Env {
  ATLASSIAN_API_KEY: string;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  OAUTH_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  AI: any; // Assuming 'AI' is a Cloudflare Workers AI binding
  MCP_OBJECT: DurableObjectNamespace<MyMCP>;
}

export class MyMCP extends McpAgent<Env, Props> {
	private jiraClient: JiraClient;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.jiraClient = new JiraClient(env);
	}

	private parseLabels(labels: string[] | string): string[] {
		let result: string[] = [];

		if (Array.isArray(labels)) {
			// Handle array input
			result = labels.map(label => {
				// If the label itself looks like a stringified array or has quotes, clean it
				if (typeof label === 'string') {
					// Remove surrounding quotes, brackets, etc.
					return label.replace(/^[\['"`]|[\]'"`]$/g, '').trim();
				}
				return String(label);
			});
		} else if (typeof labels === 'string') {
			// If the entire input is a string that looks like an array (e.g., "['test']")
			if (labels.trim().startsWith('[') && labels.trim().endsWith(']')) {
				try {
					// Try to parse it as JSON
					const parsed = JSON.parse(labels.replace(/'/g, '"'));
					if (Array.isArray(parsed)) {
						result = parsed.map(item => String(item).trim());
					} else {
						// If parsing succeeded but result isn't an array
						result = [String(parsed).trim()];
					}
				} catch (e) {
					// If parsing failed, treat the whole string as a single label
					// But remove the brackets
					result = [labels.replace(/^\[|\]$/g, '').replace(/['"`]/g, '').trim()];
				}
			} else {
				// Handle comma-separated string
				result = labels.split(',').map(s => s.trim());
			}
		}

		// Final cleanup - remove any empty strings
		return result.filter(label => label.length > 0);
	}

	server = new McpServer({
		name: "Github OAuth Proxy Demo",
		version: "1.0.0",
	});

	async init() {
		// Hello, world!
		this.server.tool(
			"add",
			"Add two numbers the way only MCP can",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ text: String(a + b), type: "text" }],
			}),
		);

		// Jira Tools
		this.server.tool(
			"createTask",
			"Create a new Jira task",
			{
				projectKey: z.string().describe("[REQUIRED] The key of the Jira project (e.g., 'TEST', 'DEV', 'PROD'). Use the 'getProjects' tool to find valid project keys."),
				summary: z.string().describe("[REQUIRED] The summary/title of the task. Keep it concise but descriptive."),
				description: z.string().optional().describe("[OPTIONAL] A detailed description of the task. Supports Jira markdown formatting."),
			},
			async ({ projectKey, summary, description }) => {
				const newTask = await this.jiraClient.createTask(projectKey, summary, description);
				return {
					content: [{ text: `Task created: ${newTask.key} (${newTask.id})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getProjects",
			"Get a list of all Jira projects",
			{},
			async () => {
				const projects = await this.jiraClient.getProjects();
				console.log('JiraProjects.getProjects raw result:', projects);
				const projectsText = projects.map((project: any) => `${project.name} (${project.key})`).join('\n');
				console.log('Formatted projectsText for tool output:', projectsText);
				return {
					content: [{ text: `Jira Projects:\n${projectsText}`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraProject",
			"Create a new Jira project",
			{
				key: z.string().describe("[REQUIRED] Project key - must be uppercase, unique, and contain only letters and numbers (e.g., 'TEST', 'DEV', 'PROD'). Maximum 10 characters."),
				name: z.string().describe("[REQUIRED] Project name - descriptive name for the project (e.g., 'Test Project', 'Development Team')."),
				projectTypeKey: z.string().describe("[REQUIRED] Project type key - common values are 'software', 'business', or 'service_desk'. Check with your Jira admin for valid values."),
				leadAccountId: z.string().describe("[REQUIRED] Account ID of the project lead - use the 'getJiraUsers' tool to find valid account IDs. This is required by the Jira API."),
				projectTemplateKey: z.string().optional().describe("[OPTIONAL/REQUIRED] Project template key - may be required depending on your Jira configuration. Common values include 'com.pyxis.greenhopper.jira:gh-scrum-template', 'com.pyxis.greenhopper.jira:gh-kanban-template'."),
				description: z.string().optional().describe("[OPTIONAL] Project description - detailed information about the project's purpose and scope."),
				url: z.string().optional().describe("[OPTIONAL] Project URL - web address associated with the project (e.g., 'https://example.com/project')."),
				assigneeType: z.string().optional().describe("[OPTIONAL] Assignee type - determines default assignee behavior. Valid values: 'PROJECT_LEAD', 'UNASSIGNED'. Default is 'PROJECT_LEAD'."),
				avatarId: z.number().optional().describe("[OPTIONAL] Avatar ID - numeric ID of the avatar to use for the project. Omit to use default avatar."),
				categoryId: z.number().optional().describe("[OPTIONAL] Category ID - numeric ID of the project category to assign this project to."),
			},
			async (payload) => {
				try {
					const newProject = await this.jiraClient.createProject(payload);

					// Create a simplified project object for machine parsing
					const projectData = {
						id: newProject.id,
						key: newProject.key,
						name: newProject.name,
						projectTypeKey: newProject.projectTypeKey,
						description: newProject.description || null,
						lead: newProject.lead ? {
							accountId: newProject.lead.accountId,
							displayName: newProject.lead.displayName
						} : null,
						success: true
					};

					// Create JSON string for machine parsing
					const projectJson = JSON.stringify(projectData, null, 2);

					return {
						content: [
							{ text: `Project created: ${newProject.name} (${newProject.key})`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`, type: "text" }
						],
					};
				} catch (error: any) { // Type error as any to access error.message
					// Provide helpful error message
					let errorMessage = `Error creating project: ${error?.message || 'Unknown error'}`;
					let errorType = "unknown";

					// Add specific guidance for common errors
					if (error?.message && typeof error.message === 'string') {
						if (error.message.includes("projectLead")) {
							errorMessage += "\n\nYou must specify a valid leadAccountId. Use the 'getJiraUsers' tool to find valid account IDs.";
							errorType = "missing_lead";
						} else if (error.message.includes("projectTypeKey")) {
							errorMessage += "\n\nInvalid projectTypeKey. Common values are 'software', 'business', or 'service_desk'.";
							errorType = "invalid_project_type";
						} else if (error.message.includes("projectTemplateKey")) {
							errorMessage += "\n\nYour Jira instance requires a projectTemplateKey. Contact your Jira admin for valid template keys.";
							errorType = "missing_template";
						}
					}

					// Create error object for machine parsing
					const errorData = {
						success: false,
						errorType: errorType,
						message: error?.message || 'Unknown error',
						payload: payload
					};

					// Create JSON string for machine parsing
					const errorJson = JSON.stringify(errorData, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"getJiraProject",
			"Get details of a specific Jira project",
			{
				projectIdOrKey: z.string().describe("[REQUIRED] Project ID or key - either the numeric ID or the project key (e.g., 'TEST', '10000'). Project key is preferred."),
				expand: z.string().optional().describe("[OPTIONAL] Comma-separated list of project properties to expand. Valid values include: 'description', 'lead', 'issueTypes', 'url', 'projectKeys', 'permissions', 'insight'")
			},
			async ({ projectIdOrKey, expand }) => {
				try {
					const project = await this.jiraClient.getProject(projectIdOrKey, expand);

					// Create a simplified project object for machine parsing
					const projectData = {
						id: project.id,
						key: project.key,
						name: project.name,
						projectTypeKey: project.projectTypeKey,
						description: project.description || null,
						lead: project.lead ? {
							accountId: project.lead.accountId,
							displayName: project.lead.displayName
						} : null,
						success: true
					};

					// Create JSON string for machine parsing
					const projectJson = JSON.stringify(projectData, null, 2);

					return {
						content: [
							{
								text: `Project: ${project.name} (${project.key})\n` +
									`ID: ${project.id}\n` +
									`Description: ${project.description || 'N/A'}\n` +
									`Project Type: ${project.projectTypeKey}\n` +
									`Lead: ${project.lead?.displayName || 'N/A'}`,
								type: "text"
							},
							{
								text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`,
								type: "text"
							}
						],
					};
				} catch (error: any) {
					const errorMessage = `Error retrieving project: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						projectIdOrKey: projectIdOrKey
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"getJiraProjectIssueTypes",
			"Get all available issue types for a Jira project, including subtask types",
			{
				projectIdOrKey: z.string().describe("[REQUIRED] ID or key of the project to retrieve issue types for"),
			},
			async ({ projectIdOrKey }) => {
				try {
					// Get all issue types available
					const issueTypes = await this.jiraClient.getProjectIssueTypes(projectIdOrKey);
					
					if (!issueTypes || issueTypes.length === 0) {
						return {
							content: [{ text: `No issue types found for project ${projectIdOrKey}.`, type: "text" }],
							data: {
								success: true,
								projectKey: projectIdOrKey,
								issueTypes: [],
								subtaskTypes: [],
								standardTypes: []
							}
						};
					}
					
					// Separate subtask types from standard types
					const subtaskTypes = issueTypes.filter(type => type && type.subtask === true);
					const standardTypes = issueTypes.filter(type => type && type.subtask !== true);
					
					// Format a human-readable response
					let result = `Issue types for project ${projectIdOrKey}:\n\n`;
					
					result += "Standard Issue Types:\n";
					if (standardTypes.length > 0) {
						standardTypes.forEach(type => {
							result += `- ${type.name} (ID: ${type.id})${type.default ? ' [DEFAULT]' : ''}\n`;
						});
					} else {
						result += "- None found\n";
					}
					
					result += "\nSubtask Issue Types:\n";
					if (subtaskTypes.length > 0) {
						subtaskTypes.forEach(type => {
							result += `- ${type.name} (ID: ${type.id})${type.default ? ' [DEFAULT]' : ''}\n`;
						});
					} else {
						result += "- None found (this project may not support subtasks)\n";
					}
					
					// Create structured data for machine parsing
					const responseData = {
						success: true,
						projectKey: projectIdOrKey,
						issueTypes: issueTypes.map(type => ({
							id: type.id,
							name: type.name,
							subtask: type.subtask === true,
							default: type.default === true
						})),
						subtaskTypes: subtaskTypes.map(type => ({
							id: type.id,
							name: type.name,
							default: type.default === true
						})),
						standardTypes: standardTypes.map(type => ({
							id: type.id,
							name: type.name,
							default: type.default === true
						}))
					};
					
					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);
					
					return {
						content: [
							{ text: result, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
						data: responseData
					};
				} catch (error: any) {
					const errorMessage = `Error retrieving issue types: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						error: errorMessage,
						projectKey: projectIdOrKey
					}, null, 2);
					
					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
						data: {
							success: false,
							error: errorMessage,
							projectKey: projectIdOrKey
						}
					};
				}
			},
		);

		this.server.tool(
			"getJiraUsers",
			"Find Jira users to get valid account IDs for project creation",
			{
				query: z.string().describe("[REQUIRED] Search query for users - can be a name, email, or username. Partial matches are supported (e.g., 'john', 'smith@example.com')."),
				maxResults: z.number().optional().describe("[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Use a smaller number for more focused results.")
			},
			async ({ query }) => {
				try {
					// Use the searchUsers method to find users
					const response = await this.jiraClient.searchUsers(query);

					if (!Array.isArray(response) || response.length === 0) {
						return {
							content: [{ text: `No users found matching "${query}"`, type: "text" }],
						};
					}

					// Format user information with account IDs in a structured way
					const formattedUsers = response.map((user: any) => ({
						displayName: user.displayName,
						email: user.emailAddress || null,
						accountId: user.accountId,
						active: user.active
					}));

					// Create a structured text format for humans
					const usersText = formattedUsers.map(user => {
						return `- ${user.displayName}\n  Account ID: ${user.accountId}\n  Email: ${user.email || 'None'}\n  Active: ${user.active ? 'Yes' : 'No'}`;
					}).join('\n\n');

					// Create a JSON string for machine parsing
					const usersJson = JSON.stringify(formattedUsers, null, 2);

					return {
						content: [
							{
								text: `Found ${response.length} users matching "${query}":\n\n${usersText}\n\nUse the accountId value when creating projects.`,
								type: "text"
							},
							{
								text: `MACHINE_PARSEABLE_DATA:\n${usersJson}`,
								type: "text"
							}
						],
					};
				} catch (error: any) {
					const errorMessage = `Error searching for users: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						error: true,
						message: error?.message || 'Unknown error',
						query: query
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"searchJiraIssues",
			"Search for Jira issues using JQL",
			{
				jql: z.string().describe("[REQUIRED] JQL query string - Jira Query Language for filtering issues (e.g., 'project=TEST AND status=Open', 'assignee=currentUser()')."),
				maxResults: z.number().optional().describe("[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Maximum allowed is 100.")
			},
			async ({ jql, maxResults }) => {
				const searchResults = await this.jiraClient.searchIssues(jql, maxResults);
				const issuesText = searchResults.issues.map(issue => `${issue.key}: ${issue.fields.summary}`).join('\n');
				return {
					content: [{ text: `Found ${searchResults.total} issues:\n${issuesText}`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraSprint",
			"Create a new Jira sprint",
			{
				name: z.string().describe("[REQUIRED] Sprint name - descriptive name for the sprint (e.g., 'Sprint 1', 'June Release')."),
				originBoardId: z.number().describe("[REQUIRED] Board ID to create the sprint in - numeric ID of the Scrum board (e.g., 123). Get this from your board URL."),
				startDate: z.string().optional().describe("[OPTIONAL] Start date in ISO format (e.g., '2025-06-30T08:00:00.000Z'). If not provided, sprint will be created in future state."),
				endDate: z.string().optional().describe("[OPTIONAL] End date in ISO format (e.g., '2025-07-14T17:00:00.000Z'). Should be after startDate."),
				goal: z.string().optional().describe("[OPTIONAL] Sprint goal - brief description of what the team aims to achieve in this sprint.")
			},
			async ({ name, startDate, endDate, originBoardId, goal }) => {
				// Create payload with only the provided fields
				const payload: any = { name, originBoardId };

				// Add optional fields if provided
				if (startDate) payload.startDate = startDate;
				if (endDate) payload.endDate = endDate;
				if (goal) payload.goal = goal;

				const newSprint = await this.jiraClient.createSprint(payload);
				return {
					content: [{ text: `Sprint created: ${newSprint.id} - ${newSprint.name}`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"startJiraSprint",
			"Start a Jira sprint",
			{
				sprintId: z.number().describe("ID of the sprint to start"),
			},
			async ({ sprintId }) => {
				await this.jiraClient.startSprint(sprintId);
				return {
					content: [{ text: `Sprint ${sprintId} started successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"completeJiraSprint",
			"Complete a Jira sprint",
			{
				sprintId: z.number().describe("ID of the sprint to complete"),
			},
			async ({ sprintId }) => {
				await this.jiraClient.completeSprint(sprintId);
				return {
					content: [{ text: `Sprint ${sprintId} completed successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getJiraSprint",
			"Get details of a Jira sprint",
			{
				sprintId: z.number().describe("ID of the sprint to retrieve"),
			},
			async ({ sprintId }) => {
				const sprint = await this.jiraClient.getSprint(sprintId);
				return {
					content: [{ text: `Sprint ${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"updateJiraSprint",
			"Update details of a Jira sprint",
			{
				sprintId: z.number().describe("ID of the sprint to update"),
				name: z.string().optional().describe("New name for the sprint"),
				startDate: z.string().optional().describe("New start date for the sprint (YYYY-MM-DD)"),
				endDate: z.string().optional().describe("New end date for the sprint (YYYY-MM-DD)"),
				state: z.enum(["future", "active", "closed"]).optional().describe("New state for the sprint"),
				goal: z.string().optional().describe("New goal for the sprint"),
			},
			async ({ sprintId, name, startDate, endDate, state, goal }) => {
				const updatedSprint = await this.jiraClient.updateSprint(sprintId, { name, startDate, endDate, state, goal });
				return {
					content: [{ text: `Sprint updated: ${updatedSprint.name} (ID: ${updatedSprint.id})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"deleteJiraSprint",
			"Delete a Jira sprint",
			{
				sprintId: z.number().describe("ID of the sprint to delete"),
			},
			async ({ sprintId }) => {
				await this.jiraClient.deleteSprint(sprintId);
				return {
					content: [{ text: `Sprint ${sprintId} deleted successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getJiraSprintsForBoard",
			"Get all sprints for a given Jira board",
			{
				boardId: z.number().describe("ID of the Jira board"),
			},
			async ({ boardId }) => {
				const sprints = await this.jiraClient.getSprintsForBoard(boardId);
				const sprintsText = sprints.map(sprint => `${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`).join('\n');
				return {
					content: [{ text: `Sprints for board ${boardId}:\n${sprintsText}`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getJiraIssuesForSprint",
			"Get all issues for a given Jira sprint",
			{
				sprintId: z.number().describe("ID of the Jira sprint"),
			},
			async ({ sprintId }) => {
				const issues = await this.jiraClient.getIssuesForSprint(sprintId);
				const issuesText = issues.map(issue => `${issue.key}: ${issue.fields.summary}`).join('\n');
				return {
					content: [{ text: `Issues for sprint ${sprintId}:\n${issuesText}`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"moveJiraIssuesToSprint",
			"Move issues to a Jira sprint",
			{
				sprintId: z.number().describe("ID of the target sprint"),
				issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
			},
			async ({ sprintId, issueIdsOrKeys }) => {
				await this.jiraClient.moveIssuesToSprint(sprintId, issueIdsOrKeys);
				return {
					content: [{ text: `Moved issues ${issueIdsOrKeys.join(', ')} to sprint ${sprintId}.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"moveJiraIssuesToBacklog",
			"Move issues to the Jira backlog",
			{
				boardId: z.number().describe("ID of the Jira board"),
				issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
			},
			async ({ boardId, issueIdsOrKeys }) => {
				await this.jiraClient.moveIssuesToBacklog(boardId, issueIdsOrKeys);
				return {
					content: [{ text: `Moved issues ${issueIdsOrKeys.join(', ')} to backlog for board ${boardId}.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraEpic",
			"Create a new Jira Epic",
			{
				projectKey: z.string().describe("The key of the Jira project (e.g., 'TEST')"),
				summary: z.string().describe("The summary/title of the Epic"),
				description: z.string().optional().describe("A detailed description of the Epic"),
			},
			async ({ projectKey, summary, description }) => {
				const newEpic = await this.jiraClient.createEpic(projectKey, summary, description);
				return {
					content: [{ text: `Epic created: ${newEpic.key} (${newEpic.id})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getJiraEpic",
			"Get details of a Jira Epic",
			{
				issueIdOrKey: z.string().describe("ID or key of the Epic to retrieve"),
			},
			async ({ issueIdOrKey }) => {
				const epic = await this.jiraClient.getEpic(issueIdOrKey);
				return {
					content: [{ text: `Epic ${epic.fields.summary} (ID: ${epic.id}, Key: ${epic.key})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"updateJiraEpic",
			"Update details of a Jira Epic",
			{
				issueIdOrKey: z.string().describe("ID or key of the Epic to update"),
				summary: z.string().optional().describe("New summary for the Epic"),
				description: z.string().optional().describe("New description for the Epic"),
			},
			async ({ issueIdOrKey, summary, description }) => {
				await this.jiraClient.updateEpic(issueIdOrKey, summary, description);
				return {
					content: [{ text: `Epic ${issueIdOrKey} updated successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"deleteJiraEpic",
			"Delete a Jira Epic",
			{
				issueIdOrKey: z.string().describe("ID or key of the Epic to delete"),
			},
			async ({ issueIdOrKey }) => {
				await this.jiraClient.deleteEpic(issueIdOrKey);
				return {
					content: [{ text: `Epic ${issueIdOrKey} deleted successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraTask",
			"Create a new Jira Task",
			{
				projectKey: z.string().describe("The key of the Jira project (e.g., 'TEST')"),
				summary: z.string().describe("The summary/title of the Task"),
				description: z.string().optional().describe("A detailed description of the Task"),
			},
			async ({ projectKey, summary, description }) => {
				const newTask = await this.jiraClient.createTask(projectKey, summary, description);
				return {
					content: [{ text: `Task created: ${newTask.key} (${newTask.id})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"getJiraTask",
			"Get details of a Jira Task",
			{
				issueIdOrKey: z.string().describe("ID or key of the Task to retrieve"),
			},
			async ({ issueIdOrKey }) => {
				const task = await this.jiraClient.getTask(issueIdOrKey);
				return {
					content: [{ text: `Task ${task.fields.summary} (ID: ${task.id}, Key: ${task.key})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"updateJiraTask",
			"Update details of a Jira Task",
			{
				issueIdOrKey: z.string().describe("ID or key of the Task to update"),
				summary: z.string().optional().describe("New summary for the Task"),
				description: z.string().optional().describe("New description for the Task"),
			},
			async ({ issueIdOrKey, summary, description }) => {
				await this.jiraClient.updateTask(issueIdOrKey, summary, description);
				return {
					content: [{ text: `Task ${issueIdOrKey} updated successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"deleteJiraTask",
			"Delete a Jira Task",
			{
				issueIdOrKey: z.string().describe("ID or key of the Task to delete"),
			},
			async ({ issueIdOrKey }) => {
				await this.jiraClient.deleteTask(issueIdOrKey);
				return {
					content: [{ text: `Task ${issueIdOrKey} deleted successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraSubtask",
			"Create a new Jira Subtask under a parent issue",
			{
				parentIssueKey: z.string({
					required_error: "Parent issue key is required. Please provide a valid Jira issue key (e.g., 'TEST-123')."
				}).describe("[REQUIRED] The key of the parent issue (e.g., 'TEST-123'). Must be an existing issue key."),
				projectKey: z.string({
					required_error: "Project key is required. Please provide a valid Jira project key (e.g., 'TEST')."
				}).describe("[OPTIONAL] The key of the Jira project. If not provided or incorrect, the parent issue's project will be used automatically."),
				summary: z.string({
					required_error: "Summary is required. Please provide a title for the subtask."
				}).min(1, "Summary cannot be empty.").describe("[REQUIRED] The summary/title of the subtask (e.g., 'Implement login feature')."),
				description: z.string().optional().describe("[OPTIONAL] A detailed description of the subtask. Supports plain text."),
				issueType: z.string().optional().describe("[OPTIONAL] The specific issue type to use for the subtask. Can be either an ID or name. If not provided, will be automatically determined."),
			},
			async ({ parentIssueKey, projectKey, summary, description, issueType }) => {
				try {
					// Validate parameters
					if (!parentIssueKey) {
						throw new Error("Parent issue key is required. Please provide a valid Jira issue key (e.g., 'TEST-123').");
					}

					if (!summary || summary.trim() === '') {
						throw new Error("Summary is required. Please provide a title for the subtask.");
					}

					// Note: projectKey is now optional in practice since we'll use the parent's project if needed
					const newSubtask = await this.jiraClient.createSubtask(parentIssueKey, projectKey || '', summary, description, issueType);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						subtaskId: newSubtask.id,
						subtaskKey: newSubtask.key,
						summary: newSubtask.fields?.summary || summary,
						parentIssueKey,
						projectKey: newSubtask.fields?.project?.key || projectKey,
						issueType: {
							id: newSubtask.fields?.issuetype?.id,
							name: newSubtask.fields?.issuetype?.name,
							requested: issueType || null
						}
					};

					return {
						content: [{ text: `Subtask created: ${newSubtask.key} (${newSubtask.id}) under parent ${parentIssueKey}`, type: "text" }],
						data: responseData
					};
				} catch (error: any) {
					// Handle specific error cases
					let errorMessage = `Error creating subtask: ${error?.message || 'Unknown error'}`;
					let errorType = "unknown_error";
					let errorDetails = {};

					// Check for specific error patterns
					if (error?.message && typeof error.message === 'string') {
						if (error.message.includes("issuetype")) {
							errorMessage = "Issue type error: The project may not support subtasks or the subtask type name may be different in your Jira instance.";
							errorMessage += "\n\nCommon subtask type names are 'Subtask', 'Sub-task', or 'Sub Task'.";
							errorType = "invalid_issue_type";
							errorDetails = { originalError: error.message };
						} else if (error.message.includes("parent")) {
							errorMessage = `Parent issue error: Ensure the parent issue '${parentIssueKey}' exists and can have subtasks.`;
							errorType = "invalid_parent";
							errorDetails = { parentIssueKey, originalError: error.message };
						} else if (error.message.includes("project")) {
							errorMessage = `Project error: Ensure the project '${projectKey}' exists and supports subtasks.`;
							errorMessage += "\n\nNote: The project key should match the project of the parent issue.";
							errorType = "invalid_project";
							errorDetails = { projectKey, originalError: error.message };
						} else if (error.message.includes("404")) {
							errorMessage = "API endpoint not found. This could be due to incorrect Jira configuration or API version mismatch.";
							errorType = "api_not_found";
							errorDetails = { originalError: error.message };
						}
					}

					return {
						content: [{ text: errorMessage, type: "text" }],
						data: {
							success: false,
							errorType,
							errorMessage,
							errorDetails
						}
					};
				}
			},
		);

		this.server.tool(
			"getJiraSubtask",
			"Get details of a Jira Subtask",
			{
				issueIdOrKey: z.string().describe("ID or key of the Subtask to retrieve"),
			},
			async ({ issueIdOrKey }) => {
				const subtask = await this.jiraClient.getSubtask(issueIdOrKey);
				return {
					content: [{ text: `Subtask ${subtask.fields.summary} (ID: ${subtask.id}, Key: ${subtask.key})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"updateJiraSubtask",
			"Update details of a Jira Subtask",
			{
				issueIdOrKey: z.string().describe("ID or key of the Subtask to update"),
				summary: z.string().optional().describe("New summary for the Subtask"),
				description: z.string().optional().describe("New description for the Subtask"),
			},
			async ({ issueIdOrKey, summary, description }) => {
				await this.jiraClient.updateSubtask(issueIdOrKey, summary, description);
				return {
					content: [{ text: `Subtask ${issueIdOrKey} updated successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"deleteJiraSubtask",
			"Delete a Jira Subtask",
			{
				issueIdOrKey: z.string().describe("ID or key of the Subtask to delete"),
			},
			async ({ issueIdOrKey }) => {
				await this.jiraClient.deleteSubtask(issueIdOrKey);
				return {
					content: [{ text: `Subtask ${issueIdOrKey} deleted successfully.`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"addJiraIssueLabels",
			"Add labels to a Jira issue",
			{
				issueIdOrKey: z.string({
					required_error: "Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID."
				}).describe("[REQUIRED] ID or key of the Jira issue (e.g., 'TEST-123', '10024'). Issue key is preferred."),
				labels: z.union([
					z.array(z.string()).min(1, "At least one label must be provided"),
					z.string().min(1, "Labels string cannot be empty").transform(val => val.split(',').map(s => s.trim()))
				], {
					errorMap: () => ({ message: "Labels are required. Provide either an array ['bug', 'frontend'] or a comma-separated string 'bug, frontend'" })
				}).describe("[REQUIRED] Labels to add to the issue. Can be provided as an array ['bug', 'frontend'] or as a comma-separated string 'bug, frontend'. Labels are case-sensitive and cannot contain spaces."),
			},
			async ({ issueIdOrKey, labels }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID.");
					}

					if (!labels || (Array.isArray(labels) && labels.length === 0)) {
						throw new Error("At least one label must be provided. Labels can be an array ['bug', 'frontend'] or a comma-separated string 'bug, frontend'.");
					}

					// Parse and sanitize labels to ensure we're not adding brackets or quotes
					const normalizedLabels = parseLabels(labels);

					// Add the labels to the issue
					await this.jiraClient.addLabels(issueIdOrKey, normalizedLabels);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						labelsAdded: normalizedLabels
					};

					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Labels ${normalizedLabels.join(', ')} added to issue ${issueIdOrKey}.`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
					};
				} catch (error: any) {
					const errorMessage = `Error adding labels to issue ${issueIdOrKey}: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						issueIdOrKey,
						labelsAttempted: Array.isArray(labels) ? [...labels] : []
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"removeJiraIssueLabels",
			"Remove labels from a Jira issue",
			{
				issueIdOrKey: z.string({
					required_error: "Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID."
				}).describe("[REQUIRED] ID or key of the Jira issue (e.g., 'TEST-123', '10024'). Issue key is preferred."),
				labels: z.union([
					z.array(z.string()).min(1, "At least one label must be provided"),
					z.string().min(1, "Labels string cannot be empty").transform(val => val.split(',').map(s => s.trim()))
				], {
					errorMap: () => ({ message: "Labels are required. Provide either an array ['bug', 'frontend'] or a comma-separated string 'bug, frontend'" })
				}).describe("[REQUIRED] Labels to remove from the issue. Can be provided as an array ['bug', 'frontend'] or as a comma-separated string 'bug, frontend'. Only existing labels matching exactly will be removed."),
			},
			async ({ issueIdOrKey, labels }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID.");
					}

					if (!labels || (Array.isArray(labels) && labels.length === 0)) {
						throw new Error("At least one label must be provided. Labels can be an array ['bug', 'frontend'] or a comma-separated string 'bug, frontend'.");
					}

					// Parse and sanitize labels to ensure we're not adding brackets or quotes
					const normalizedLabels = parseLabels(labels);

					// Remove the labels from the issue
					await this.jiraClient.removeLabels(issueIdOrKey, normalizedLabels);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						labelsRemoved: normalizedLabels
					};

					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Labels ${normalizedLabels.join(', ')} removed from issue ${issueIdOrKey}.`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
					};
				} catch (error: any) {
					const errorMessage = `Error removing labels from issue ${issueIdOrKey}: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						issueIdOrKey,
						labelsAttempted: Array.isArray(labels) ? [...labels] : []
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"setJiraIssueLabels",
			"Set labels for a Jira issue (overwrites existing labels)",
			{
				issueIdOrKey: z.string({
					required_error: "Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID."
				}).describe("[REQUIRED] ID or key of the Jira issue (e.g., 'TEST-123', '10024'). Issue key is preferred."),
				labels: z.union([
					z.array(z.string()),
					z.string().transform(val => val.split(',').map(s => s.trim()))
				], {
					errorMap: () => ({ message: "Labels are required. Provide either an array ['bug', 'frontend'] or a comma-separated string 'bug, frontend'" })
				}).describe("[REQUIRED] Labels to set on the issue. Can be provided as an array ['bug', 'frontend'] or as a comma-separated string 'bug, frontend'. This will REPLACE ALL existing labels with these new ones."),
			},
			async ({ issueIdOrKey, labels }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required. Please provide a valid Jira issue key (e.g., 'TEST-123') or ID.");
					}

					// For setJiraIssueLabels, empty array is valid (to clear all labels)
					if (labels === undefined) {
						throw new Error("Labels parameter is required. To clear all labels, provide an empty array [].");
					}

					// Parse and sanitize labels to ensure we're not adding brackets or quotes
					const normalizedLabels = parseLabels(labels);

					// Set the labels on the issue
					await this.jiraClient.setLabels(issueIdOrKey, normalizedLabels);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						labelsSet: normalizedLabels
					};

					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Labels for issue ${issueIdOrKey} set to ${normalizedLabels.join(', ')}.`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
					};
				} catch (error: any) {
					const errorMessage = `Error setting labels for issue ${issueIdOrKey}: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						issueIdOrKey,
						labels: Array.isArray(labels) ? [...labels] : []
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
					};
				}
			},
		);

		this.server.tool(
			"updateJiraIssue",
			"Update any field on a Jira issue",
			{
				issueIdOrKey: z.string().describe("[REQUIRED] ID or key of the issue to update (e.g., 'TEST-123')"),
				fields: z.record(z.any()).describe("[REQUIRED] Object containing the fields to update. Supports any valid Jira field. Common fields include:\n\n- summary: String - The issue title/summary\n- description: String or Object - Issue description (simple strings will be automatically converted to Jira document format)\n- priority: Object - Issue priority, e.g., { id: '1' } or { name: 'Highest' }\n- assignee: Object - The assignee, e.g., { accountId: 'user-account-id' } or { name: 'username' }\n- labels: Array - Issue labels, e.g., ['bug', 'critical']\n- components: Array - Components, e.g., [{ id: '10000' }] or [{ name: 'Frontend' }]\n- fixVersions: Array - Fix versions, e.g., [{ id: '10001' }] or [{ name: '2.0' }]\n- duedate: String - Due date in format 'YYYY-MM-DD'\n- customfield_XXXXX: Any - Any custom field where XXXXX is the field ID\n\nExample: { summary: 'New title', description: 'New description', priority: { id: '1' }, labels: ['bug', 'critical'] }")
			},
			async ({ issueIdOrKey, fields }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required.");
					}

					if (!fields || Object.keys(fields).length === 0) {
						throw new Error("At least one field must be provided for update.");
					}

					// Update the issue
					await this.jiraClient.updateIssue(issueIdOrKey, fields);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						updatedFields: Object.keys(fields)
					};

					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Issue ${issueIdOrKey} updated successfully.`, type: "text" },
							{ text: `Updated fields: ${Object.keys(fields).join(', ')}`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
						data: responseData
					};
				} catch (error: any) {
					const errorMessage = `Error updating issue: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						error: errorMessage,
						issueIdOrKey
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
						data: {
							success: false,
							error: errorMessage,
							issueIdOrKey
						}
					};
				}
			},
		);

		this.server.tool(
			"getJiraIssueTransitions",
			"Get available transitions for a Jira issue",
			{
				issueIdOrKey: z.string().describe("[REQUIRED] ID or key of the issue to get transitions for (e.g., 'TEST-123')")
			},
			async ({ issueIdOrKey }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required.");
					}

					// Get transitions for the issue
					const transitionsResponse = await this.jiraClient.getTransitions(issueIdOrKey);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						transitions: transitionsResponse.transitions.map((t: { id: string; name: string; to: { id: string; name: string; statusCategory: { name: string } } }) => ({
							id: t.id,
							name: t.name,
							toStatus: {
								id: t.to.id,
								name: t.to.name,
								category: t.to.statusCategory.name
							}
						}))
					};

					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Available transitions for issue ${issueIdOrKey}:`, type: "text" },
							{ text: transitionsResponse.transitions.map((t: { id: string; name: string; to: { name: string } }) => `- ${t.name} (ID: ${t.id}) → ${t.to.name}`).join('\n'), type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
						data: responseData
					};
				} catch (error: any) {
					const errorMessage = `Error getting transitions for issue ${issueIdOrKey}: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						issueIdOrKey
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
						data: {
							success: false,
							message: error?.message || 'Unknown error',
							issueIdOrKey
						}
					};
				}
			},
		);

		this.server.tool(
			"transitionJiraIssue",
			"Change the status of a Jira issue using transitions",
			{
				issueIdOrKey: z.string().describe("[REQUIRED] ID or key of the issue to transition (e.g., 'TEST-123')"),
				transitionId: z.string().describe("[REQUIRED] ID of the transition to perform. Use getJiraIssueTransitions to find available transition IDs."),
				comment: z.string().optional().describe("[OPTIONAL] Comment to add when performing the transition")
			},
			async ({ issueIdOrKey, transitionId, comment }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required.");
					}

					if (!transitionId) {
						throw new Error("Transition ID is required.");
					}

					// Perform the transition
					await this.jiraClient.doTransition(issueIdOrKey, transitionId, comment);

					// Get the issue to confirm the new status
					const issue = await this.jiraClient.getIssue(issueIdOrKey);
					const newStatus = issue.fields.status?.name || 'Unknown';

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issueIdOrKey,
						transitionId,
						newStatus,
						commentAdded: !!comment
					};

					const responseJson = JSON.stringify(responseData, null, 2);

					return {
						content: [
							{ text: `Issue ${issueIdOrKey} transitioned successfully to status: ${newStatus}`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
						data: responseData
					};
				} catch (error: any) {
					const errorMessage = `Error transitioning issue ${issueIdOrKey}: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						message: error?.message || 'Unknown error',
						issueIdOrKey,
						transitionId,
						comment: comment || null
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
						data: {
							success: false,
							message: error?.message || 'Unknown error',
							issueIdOrKey,
							transitionId,
							comment: comment || null
						}
					};
				}
			},
		);

		this.server.tool(
			"getJiraIssue",
			"Get details of a Jira issue by ID or key",
			{
				issueIdOrKey: z.string().describe("[REQUIRED] ID or key of the issue to retrieve (e.g., 'TEST-123')")
			},
			async ({ issueIdOrKey }) => {
				try {
					// Validate parameters
					if (!issueIdOrKey) {
						throw new Error("Issue ID or key is required.");
					}

					// Get the issue details
					const issue = await this.jiraClient.getIssue(issueIdOrKey);

					// Create response data for machine parsing
					const responseData = {
						success: true,
						issue
					};

					// Create JSON string for machine parsing
					const responseJson = JSON.stringify(responseData, null, 2);

					// Extract key information for human-readable response
					const summary = issue.fields?.summary || 'No summary';
					// Use type assertion for fields not explicitly defined in JiraIssueFields type
					const status = (issue.fields as any)?.status?.name || 'Unknown status';
					const issueType = issue.fields?.issuetype?.name || 'Unknown type';
					const projectKey = issue.fields?.project?.key || 'Unknown project';

					return {
						content: [
							{ text: `Issue ${issueIdOrKey} details:`, type: "text" },
							{ text: `Type: ${issueType}`, type: "text" },
							{ text: `Project: ${projectKey}`, type: "text" },
							{ text: `Summary: ${summary}`, type: "text" },
							{ text: `Status: ${status}`, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
						],
						data: responseData
					};
				} catch (error: any) {
					const errorMessage = `Error retrieving issue: ${error?.message || 'Unknown error'}`;
					const errorJson = JSON.stringify({
						success: false,
						error: errorMessage,
						issueIdOrKey
					}, null, 2);

					return {
						content: [
							{ text: errorMessage, type: "text" },
							{ text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
						],
						data: {
							success: false,
							error: errorMessage,
							issueIdOrKey
						}
					};
				}
			},
		);

		this.server.tool(
			"getJiraUser",
			"Get details of a Jira user",
			{
				accountId: z.string().describe("Account ID of the user to retrieve"),
			},
			async ({ accountId }) => {
				const user = await this.jiraClient.getUser(accountId);
				return {
					content: [{ text: `User: ${user.displayName} (Account ID: ${user.accountId}, Email: ${user.emailAddress})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"createJiraUser",
			"Create a new Jira user",
			{
				emailAddress: z.string().describe("Email address of the new user"),
				password: z.string().describe("Password for the new user"),
				displayName: z.string().describe("Display name of the new user"),
			},
			async ({ emailAddress, password, displayName }) => {
				const newUser = await this.jiraClient.createUser({ emailAddress, password, displayName });
				return {
					content: [{ text: `User created: ${newUser.displayName} (Account ID: ${newUser.accountId})`, type: "text" }],
				};
			},
		);

		this.server.tool(
			"deleteJiraUser",
			"Delete a Jira user",
			{
				accountId: z.string().describe("Account ID of the user to delete"),
			},
			async ({ accountId }) => {
				await this.jiraClient.deleteUser(accountId);
				return {
					content: [{ text: `User ${accountId} deleted successfully.`, type: "text" }],
				};
			},
		);


		// Use the upstream access token to facilitate tools
		this.server.tool(
			"userInfoOctokit",
			"Get user info from GitHub, via Octokit",
			{},
			async () => {
				const octokit = new Octokit({ auth: this.props.accessToken as string });
				return {
					content: [
						{
							text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
							type: "text",
						},
					],
				};
			},
		);

		// Dynamically add tools based on the user's login. In this case, I want to limit
		// access to my Image Generation tool to just me
		if (ALLOWED_USERNAMES.has(this.props.login as string)) {
			this.server.tool(
				"generateImage",
				"Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
				{
					prompt: z
						.string()
						.describe("A text description of the image you want to generate."),
					steps: z
						.number()
						.min(4)
						.max(8)
						.default(4)
						.describe(
							"The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.",
						),
				},
				async ({ prompt, steps }) => {
					const response = await this.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
						prompt,
						steps,
					});

					return {
						content: [{ data: response.image!, mimeType: "image/jpeg", type: "image" }],
					};
				},
			);
		}
	}
}

export default new OAuthProvider({
	apiHandlers: {
		'/sse': MyMCP.serveSSE('/sse'),
		'/mcp': MyMCP.serve('/mcp'),
	  },
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
