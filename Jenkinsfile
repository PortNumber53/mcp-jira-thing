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

    stage('Archive Artifact') {
      steps {
        sh 'tar -czf backend/bin/mcp-backend.tar.gz -C backend/bin mcp-backend'
        archiveArtifacts artifacts: 'backend/bin/mcp-backend.tar.gz', fingerprint: true
      }
    }

    stage('Deploy') {
      when {
        branch 'master'
      }
      steps {
        sh 'scripts/deploy-backend.sh'
      }
    }
  }

  post {
    always {
      cleanWs()
    }
  }
}
