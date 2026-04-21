# MJT-50: Workflow Management System Design

## Overview
Design and implement a workflow management system that allows users to create workflows to execute complex tasks requiring multiple steps. Workflows react to events, execute templated system prompts, call tools and sub-agents, generate artifacts, and chain other workflows.

## Core Concepts

### 1. Workflow Definition
A workflow is a directed acyclic graph (DAG) of steps that execute in sequence or parallel. Each step can:
- Process input data
- Call tools or sub-agents
- Generate output
- Trigger other workflows

### 2. Event-Driven Architecture
Workflows are triggered by events:
- Webhook payloads
- Scheduled triggers
- Manual execution
- Other workflow completions

### 3. Templated System Prompts
Dynamic prompt generation using templates:
- Context injection from event data
- Variable substitution
- Conditional logic
- Prompt chaining

### 4. Tool & Agent Integration
Seamless integration with existing tools and agents:
- Tool calling capabilities
- Sub-agent spawning
- Parallel execution
- Error handling and retries

## System Architecture

### 1. High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Event Source  │    │   Workflow      │    │   Execution     │
│   (Webhook,     │───>│   Engine        │───>│   Engine        │
│    Schedule)    │    │   (Orchestrator)│    │   (Workers)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                               │                     │
                               │                     │
                        ┌──────▼──────┐      ┌──────▼──────┐
                        │   Workflow  │      │   Tool &    │
                        │   Store     │      │   Agent     │
                        │   (Database)│      │   Registry  │
                        └─────────────┘      └─────────────┘
```

### 2. Component Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Management System                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Event     │  │   Workflow  │  │   Execution │         │
│  │   Router    │  │   Engine    │  │   Engine    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Template  │  │   Tool &    │  │   State     │         │
│  │   Engine    │  │   Agent     │  │   Manager   │         │
│  │             │  │   Registry  │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Storage   │  │   Monitor   │  │   API       │         │
│  │   Layer     │  │   & Logs    │  │   Gateway   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### 1. Database Schema
```sql
-- Workflows table
CREATE TABLE workflows (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(20) NOT NULL,
    trigger_config JSONB NOT NULL, -- Event configuration
    steps_config JSONB NOT NULL,   -- Workflow steps definition
    variables JSONB DEFAULT '{}',  -- Workflow variables
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow steps
CREATE TABLE workflow_steps (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflows(id),
    step_order INTEGER NOT NULL,
    step_type VARCHAR(50) NOT NULL, -- tool_call, agent_call, prompt, artifact, workflow
    step_config JSONB NOT NULL,     -- Step-specific configuration
    input_mapping JSONB DEFAULT '{}',
    output_mapping JSONB DEFAULT '{}',
    error_handling JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow executions
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflows(id),
    trigger_event JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, running, completed, failed, cancelled
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    execution_context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step executions
CREATE TABLE step_executions (
    id UUID PRIMARY KEY,
    execution_id UUID REFERENCES workflow_executions(id),
    step_id UUID REFERENCES workflow_steps(id),
    step_order INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow templates
CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    template_config JSONB NOT NULL,
    is_public BOOLEAN DEFAULT false,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool registry
CREATE TABLE tool_registry (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    tool_type VARCHAR(50) not null, -- api, function, agent, workflow
    config_schema JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent registry
CREATE TABLE agent_registry (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    agent_type VARCHAR(50) NOT NULL, -- llm, specialized, composite
    capabilities TEXT[],
    config_schema JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Workflow Definition Schema
```json
{
  "name": "Webhook Processor",
  "description": "Process incoming webhook payloads",
  "version": "1.0.0",
  "trigger": {
    "type": "webhook",
    "config": {
      "path": "/webhooks/github",
      "method": "POST",
      "headers": {
        "X-GitHub-Event": "push"
      }
    }
  },
  "variables": {
    "repo_name": "{{payload.repository.name}}",
    "commit_message": "{{payload.head_commit.message}}"
  },
  "steps": [
    {
      "id": "step1",
      "type": "prompt",
      "config": {
        "template": "Analyze this commit: {{commit_message}}",
        "model": "gpt-4",
        "max_tokens": 1000
      },
      "input_mapping": {
        "commit_message": "variables.commit_message"
      },
      "output_mapping": {
        "analysis": "result.content"
      }
    },
    {
      "id": "step2",
      "type": "tool_call",
      "config": {
        "tool_name": "create_jira_ticket",
        "parameters": {
          "project": "DEV",
          "summary": "Code review needed for {{repo_name}}",
          "description": "{{step1.analysis}}"
        }
      },
      "input_mapping": {
        "repo_name": "variables.repo_name",
        "analysis": "step1.analysis"
      }
    }
  ]
}
```

## Core Components

### 1. Event Router
```go
// internal/workflow/event_router.go
type EventRouter struct {
    workflows map[string][]*Workflow
    mu        sync.RWMutex
}

func (r *EventRouter) RouteEvent(event Event) ([]*Workflow, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    
    var matchingWorkflows []*Workflow
    for _, workflow := range r.workflows[event.Type] {
        if workflow.MatchesEvent(event) {
            matchingWorkflows = append(matchingWorkflows, workflow)
        }
    }
    
    return matchingWorkflows, nil
}

func (r *EventRouter) RegisterWorkflow(workflow *Workflow) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    
    for _, eventType := range workflow.Trigger.EventTypes {
        r.workflows[eventType] = append(r.workflows[eventType], workflow)
    }
    
    return nil
}
```

### 2. Workflow Engine
```go
// internal/workflow/engine.go
type WorkflowEngine struct {
    eventRouter   *EventRouter
    executor      *Executor
    templateEngine *TemplateEngine
    toolRegistry  *ToolRegistry
    agentRegistry *AgentRegistry
    stateManager  *StateManager
}

func (e *WorkflowEngine) ExecuteWorkflow(ctx context.Context, workflow *Workflow, event Event) (*Execution, error) {
    // Create execution context
    execution := &Execution{
        ID:          uuid.New(),
        WorkflowID:  workflow.ID,
        TriggerEvent: event,
        Status:      StatusPending,
        Context:     make(map[string]interface{}),
    }
    
    // Initialize context with event data
    execution.Context["event"] = event.Data
    execution.Context["variables"] = workflow.Variables
    
    // Execute workflow steps
    for _, step := range workflow.Steps {
        if err := e.executeStep(ctx, execution, step); err != nil {
            execution.Status = StatusFailed
            execution.Error = err.Error()
            return execution, err
        }
    }
    
    execution.Status = StatusCompleted
    execution.CompletedAt = time.Now()
    
    return execution, nil
}

func (e *WorkflowEngine) executeStep(ctx context.Context, execution *Execution, step *Step) error {
    // Create step execution
    stepExecution := &StepExecution{
        ID:          uuid.New(),
        ExecutionID: execution.ID,
        StepID:      step.ID,
        StepOrder:   step.Order,
        Status:      StatusRunning,
        StartedAt:   time.Now(),
    }
    
    // Execute based on step type
    switch step.Type {
    case StepTypePrompt:
        return e.executePromptStep(ctx, execution, step, stepExecution)
    case StepTypeToolCall:
        return e.executeToolCallStep(ctx, execution, step, stepExecution)
    case StepTypeAgentCall:
        return e.executeAgentCallStep(ctx, execution, step, stepExecution)
    case StepTypeWorkflow:
        return e.executeWorkflowStep(ctx, execution, step, stepExecution)
    case StepTypeArtifact:
        return e.executeArtifactStep(ctx, execution, step, stepExecution)
    default:
        return fmt.Errorf("unknown step type: %s", step.Type)
    }
}
```

### 3. Template Engine
```go
// internal/workflow/template_engine.go
type TemplateEngine struct {
    templates map[string]*Template
    mu        sync.RWMutex
}

func (e *TemplateEngine) Render(templateName string, data map[string]interface{}) (string, error) {
    e.mu.RLock()
    template, ok := e.templates[templateName]
    e.mu.RUnlock()
    
    if !ok {
        return "", fmt.Errorf("template not found: %s", templateName)
    }
    
    return template.Render(data)
}

func (e *TemplateEngine) RenderString(templateStr string, data map[string]interface{}) (string, error) {
    // Parse template string
    tmpl, err := template.New("dynamic").Parse(templateStr)
    if err != nil {
        return "", err
    }
    
    // Execute template
    var buf bytes.Buffer
    if err := tmpl.Execute(&buf, data); err != nil {
        return "", err
    }
    
    return buf.String(), nil
}
```

### 4. Tool & Agent Registry
```go
// internal/workflow/registry.go
type ToolRegistry struct {
    tools map[string]*Tool
    mu    sync.RWMutex
}

func (r *ToolRegistry) CallTool(ctx context.Context, toolName string, params map[string]interface{}) (interface{}, error) {
    r.mu.RLock()
    tool, ok := r.tools[toolName]
    r.mu.RUnlock()
    
    if !ok {
        return nil, fmt.Errorf("tool not found: %s", toolName)
    }
    
    return tool.Call(ctx, params)
}

type AgentRegistry struct {
    agents map[string]*Agent
    mu     sync.RWMutex
}

func (r *AgentRegistry) CallAgent(ctx context.Context, agentName string, task string, context map[string]interface{}) (interface{}, error) {
    r.mu.RLock()
    agent, ok := r.agents[agentName]
    r.mu.RUnlock()
    
    if !ok {
        return nil, fmt.Errorf("agent not found: %s", agentName)
    }
    
    return agent.Execute(ctx, task, context)
}
```

## API Endpoints

### 1. Workflow Management
```
GET    /api/workflows                    # List all workflows
GET    /api/workflows/:id                # Get workflow details
POST   /api/workflows                    # Create workflow
PUT    /api/workflows/:id                # Update workflow
DELETE /api/workflows/:id                # Delete workflow
POST   /api/workflows/:id/activate      # Activate workflow
POST   /api/workflows/:id/deactivate    # Deactivate workflow
GET    /api/workflows/:id/executions     # Get workflow executions
POST   /api/workflows/:id/execute        # Manually execute workflow
```

### 2. Workflow Templates
```
GET    /api/workflow-templates           # List templates
GET    /api/workflow-templates/:id       # Get template details
POST   /api/workflow-templates           # Create template
PUT    /api/workflow-templates/:id       # Update template
DELETE /api/workflow-templates/:id       # Delete template
POST   /api/workflow-templates/:id/instantiate  # Create workflow from template
```

### 3. Execution Management
```
GET    /api/executions                   # List executions
GET    /api/executions/:id               # Get execution details
POST   /api/executions/:id/cancel        # Cancel execution
GET    /api/executions/:id/logs          # Get execution logs
GET    /api/executions/:id/steps         # Get step executions
POST   /api/executions/:id/retry         # Retry failed execution
```

### 4. Tool & Agent Management
```
GET    /api/tools                        # List tools
GET    /api/tools/:id                    # Get tool details
POST   /api/tools                        # Register tool
PUT    /api/tools/:id                    # Update tool
DELETE /api/tools/:id                    # Delete tool
POST   /api/tools/:id/test               # Test tool

GET    /api/agents                       # List agents
GET    /api/agents/:id                   # Get agent details
POST   /api/agents                       # Register agent
PUT    /api/agents/:id                   # Update agent
DELETE /api/agents/:id                   # Delete agent
POST   /api/agents/:id/test              # Test agent
```

## Workflow Step Types

### 1. Prompt Step
```json
{
  "type": "prompt",
  "config": {
    "template": "Analyze this data: {{data}}",
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 1000,
    "system_prompt": "You are a data analyst"
  }
}
```

### 2. Tool Call Step
```json
{
  "type": "tool_call",
  "config": {
    "tool_name": "create_jira_ticket",
    "parameters": {
      "project": "DEV",
      "summary": "{{title}}",
      "description": "{{description}}"
    },
    "timeout": 30,
    "retries": 3
  }
}
```

### 3. Agent Call Step
```json
{
  "type": "agent_call",
  "config": {
    "agent_name": "code_reviewer",
    "task": "Review this code: {{code}}",
    "context": {
      "language": "go",
      "standards": "company_guidelines"
    },
    "timeout": 300
  }
}
```

### 4. Workflow Step
```json
{
  "type": "workflow",
  "config": {
    "workflow_id": "child_workflow_id",
    "input_mapping": {
      "parent_data": "{{step1.output}}",
      "config": "{{variables}}"
    },
    "wait_for_completion": true
  }
}
```

### 5. Artifact Step
```json
{
  "type": "artifact",
  "config": {
    "artifact_type": "file",
    "name": "report.txt",
    "content": "{{step1.output}}",
    "storage": "s3",
    "metadata": {
      "workflow_id": "{{workflow_id}}",
      "execution_id": "{{execution_id}}"
    }
  }
}
```

## Error Handling & Retries

### 1. Step-Level Error Handling
```json
{
  "error_handling": {
    "on_failure": "retry",
    "max_retries": 3,
    "retry_delay": 5,
    "retry_backoff": "exponential",
    "fallback_step": "fallback_step_id",
    "notify_on_failure": true
  }
}
```

### 2. Workflow-Level Error Handling
```json
{
  "error_handling": {
    "on_step_failure": "continue",
    "on_critical_failure": "stop",
    "notify_on_failure": true,
    "notification_channels": ["email", "slack"],
    "cleanup_on_failure": true
  }
}
```

## State Management

### 1. Execution Context
```go
type ExecutionContext struct {
    WorkflowID   string                 `json:"workflow_id"`
    ExecutionID  string                 `json:"execution_id"`
    TriggerEvent map[string]interface{} `json:"trigger_event"`
    Variables    map[string]interface{} `json:"variables"`
    StepOutputs  map[string]interface{} `json:"step_outputs"`
    Artifacts    []Artifact             `json:"artifacts"`
    Metadata     map[string]interface{} `json:"metadata"`
}
```

### 2. State Persistence
- **Redis**: For fast access to execution state
- **PostgreSQL**: For durable storage of executions and history
- **S3**: For artifact storage
- **Elasticsearch**: For logs and search

## Monitoring & Observability

### 1. Metrics
- `workflow_executions_total` - Total workflow executions
- `workflow_execution_duration_seconds` - Execution duration
- `workflow_step_duration_seconds` - Step duration
- `workflow_errors_total` - Total errors
- `workflow_retries_total` - Total retries

### 2. Logging
- Structured JSON logs
- Correlation IDs across workflow steps
- Log levels: DEBUG, INFO, WARN, ERROR
- Log retention policies

### 3. Tracing
- OpenTelemetry integration
- Trace workflow execution across steps
- Span for each step execution
- Context propagation across services

## Security Considerations

### 1. Authentication & Authorization
- API key authentication for external triggers
- Role-based access control (RBAC)
- Workflow ownership and permissions
- Audit logging for all operations

### 2. Input Validation
- Schema validation for workflow definitions
- Input sanitization for event data
- Rate limiting for webhook triggers
- DDoS protection

### 3. Execution Isolation
- Sandboxed execution for untrusted code
- Resource limits per workflow
- Timeout enforcement
- Memory and CPU quotas

## Implementation Phases

### Phase 1: Core Engine (Week 1)
1. **Database Schema**
   - Create tables for workflows, steps, executions
   - Add indexes and constraints
   - Create migrations

2. **Basic API**
   - CRUD for workflows
   - Workflow execution
   - Execution status tracking

3. **Event Router**
   - Basic event routing
   - Webhook endpoint

### Phase 2: Execution Engine (Week 2)
1. **Step Execution**
   - Step types implementation
   - Error handling
   - State management

2. **Template Engine**
   - Template parsing
   - Variable substitution
   - Context injection

3. **Tool Registry**
   - Tool registration
   - Tool execution
   - Error handling

### Phase 3: Advanced Features (Week 3)
1. **Agent Integration**
   - Agent registry
   - Agent execution
   - Context passing

2. **Workflow Chaining**
   - Parent-child workflows
   - Data passing between workflows
   - Parallel execution

3. **Artifact Management**
   - Artifact generation
   - Storage integration
   - Metadata management

### Phase 4: Production Ready (Week 4)
1. **Monitoring & Logging**
   - Metrics collection
   - Structured logging
   - Tracing

2. **Security & Performance**
   - Authentication
   - Authorization
   - Performance optimization

3. **Documentation & Testing**
   - API documentation
   - User guides
   - Test coverage

## Success Metrics

### 1. Adoption Metrics
- 100+ workflows created in first month
- 1000+ workflow executions per day
- 90% workflow success rate

### 2. Performance Metrics
- Workflow execution < 5 seconds (average)
- Step execution < 1 second (average)
- 99.9% system availability

### 3. User Experience
- Workflow creation < 5 minutes
- Execution monitoring in real-time
- Error debugging < 2 minutes

## Future Enhancements

### 1. Advanced Features
- Visual workflow builder
- A/B testing for workflows
- Machine learning for workflow optimization

### 2. Integrations
- More tool integrations
- External service connectors
- Custom agent development

### 3. Enterprise Features
- Multi-tenancy
- Advanced analytics
- Custom deployment options

---

**Document Version:** 1.0  
**Author:** AI Assistant  
**Date:** $(date)  
**Status:** Draft - Pending Review