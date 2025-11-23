pipeline {
  agent any

  environment {
    GOFLAGS = "-mod=readonly"
  }

  options {
    timestamps()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Go Test') {
      steps {
        sh 'cd backend && go test ./...'
      }
    }

    stage('Build Backend') {
      steps {
        sh 'cd backend && make build'
      }
    }

    stage('Deploy MCP Worker') {
      environment {
        // Reuse Cloudflare API token for deploying the MCP worker defined in wrangler.jsonc
        CLOUDFLARE_API_TOKEN = credentials('cloudflare-api-token')
      }
      steps {
        // Build the SPA assets and deploy the single merged Worker from the repository root.
        sh 'cd frontend && npm ci && npm run build'
        sh 'npm ci'
        sh 'npm run deploy'
      }
    }

    stage('Archive Artifact') {
      steps {
        sh 'tar -czf backend/bin/mcp-backend.tar.gz -C backend/bin mcp-backend'
        archiveArtifacts artifacts: 'backend/bin/mcp-backend.tar.gz', fingerprint: true
      }
    }

    stage('Deploy Backend') {
      when {
        branch 'master'
      }
      environment {
        // Xata database URL for backend migrations and runtime
        DATABASE_URL = credentials('prod-xata-database-url-mcp-jira-thing')
      }
      steps {
        withEnv([
          'DEPLOY_HOST=web1',
          'DEPLOY_USER=grimlock',
          'DEPLOY_PATH=/var/www/vhosts/mcp-jira-thing.truvis.co',
          'SERVICE_NAME=mcp-backend',
        ]) {
          sh 'scripts/deploy-backend.sh'
        }
      }
    }
  }

  post {
    always {
      cleanWs()
    }
  }
}
