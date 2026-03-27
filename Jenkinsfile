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

    stage('Build Frontend') {
      steps {
        sh 'cd frontend && npm ci && npm run build'
      }
    }

    stage('Deploy Cloudflare Worker') {
      when {
        branch 'master'
      }
      environment {
        // Cloudflare API token for Wrangler deploys.
        CLOUDFLARE_API_TOKEN = credentials('cloudflare-api-token')
        // Production Worker configuration.
        BACKEND_BASE_URL = credentials('prod-backend-url-api-jira-thing')
        SESSION_SECRET = credentials('prod-jwt-secret-api-jira-thing')
        GITHUB_CLIENT_ID = credentials('prod-githuib-client-id-api-jira-thing')
        GITHUB_CLIENT_SECRET = credentials('prod-githuib-client-secret-api-jira-thing')
        GOOGLE_CLIENT_ID = credentials('prod-google-client-id-api-jira-thing')
        GOOGLE_CLIENT_SECRET = credentials('prod-google-client-secret-api-jira-thing')
        COOKIE_DOMAIN = credentials('prod-cookie-domain-api-jira-thing')
      }
      steps {
        // Install root dependencies (Worker code).
        sh 'npm ci'

        // Sync secrets into the production Worker.
        sh 'echo "$SESSION_SECRET" | npx wrangler secret put SESSION_SECRET --env production'
        sh 'echo "$GITHUB_CLIENT_SECRET" | npx wrangler secret put GITHUB_CLIENT_SECRET --env production'
        sh 'echo "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET --env production'
        // Remove COOKIE_DOMAIN secret (was mistakenly uploaded as a secret; now passed as a plain var).
        sh 'npx wrangler secret delete COOKIE_DOMAIN --env production --force || true'
        // Deploy the merged Worker (serves SPA at / and MCP at /sse).
        sh 'npx wrangler deploy --env production --var BACKEND_BASE_URL:$BACKEND_BASE_URL --var GITHUB_CLIENT_ID:$GITHUB_CLIENT_ID --var GOOGLE_CLIENT_ID:$GOOGLE_CLIENT_ID --var COOKIE_DOMAIN:$COOKIE_DOMAIN --var INTEGRATION_GOOGLE_DOCS_ENABLED:true'
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
        // Primary database URL used by the backend at runtime.
        DATABASE_URL = credentials('prod-database-url-api-jira-thing')
        // Google OAuth credentials (shared with Cloudflare Worker stage).
        GOOGLE_CLIENT_ID = credentials('prod-google-client-id-api-jira-thing')
        GOOGLE_CLIENT_SECRET = credentials('prod-google-client-secret-api-jira-thing')
        // Cookie/session signing key (shared with Cloudflare Worker).
        COOKIE_SECRET = credentials('prod-jwt-secret-api-jira-thing')
        COOKIE_DOMAIN = credentials('prod-cookie-domain-api-jira-thing')
      }
      steps {
        withEnv([
          'DEPLOY_HOST=web1',
          'DEPLOY_USER=grimlock',
          'DEPLOY_PATH=/var/www/vhosts/api-jira-thing.truvis.co',
          'SERVICE_NAME=api-jira-thing',
          // Always publish /etc/api-jira-thing.truvis.co/config.ini from Jenkins env/credentials
          // so secrets can be rotated by updating credentials and re-deploying.
          'DEPLOY_PUBLISH_CONFIG_INI=1',
          // Frontend and API origins for OAuth redirects.
          'FRONTEND_URL=https://jira-thing.truvis.co',
          'BACKEND_URL=https://api-jira-thing.truvis.co',
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
