// MEDSP Multibranch CI/CD: one controller, two isolated deployment agents.
// Required plugins: Pipeline (Declarative), Git, GitHub Branch Source,
// Credentials Binding, Timestamper, Lockable Resources and SSH Build Agents.
pipeline {
    agent none

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        disableRestartFromStage()
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('Branch gate') {
            steps {
                script {
                    env.LAST_PHASE = 'Branch gate'
                    env.TRIGGER_ACTOR = 'GitHub / SCM / branch indexing'
                    env.INFRASH_CONFIG = ''
                    env.INFRASH_RUN_ID = ''
                    if (!(env.BRANCH_NAME in ['main', 'staging']) || env.CHANGE_ID) {
                        error('Only main and staging are deployable; pull requests are excluded.')
                    }
                    env.DEPLOY_ENV = (env.BRANCH_NAME == 'main') ? 'production' : 'staging'
                    env.TARGET_AGENT = (env.BRANCH_NAME == 'main') ?
                        'medsp-prod-agent' : 'medsp-stg-agent'
                    env.INFRASH_CONFIG = "/etc/medsp/${env.BRANCH_NAME}.conf"
                    def manual = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                    if (manual && manual.size() > 0) {
                        env.TRIGGER_ACTOR = 'Jenkins user: ' +
                            (manual[0].userName ?: manual[0].userId ?: 'unknown')
                    }
                    echo "Branch ${env.BRANCH_NAME} -> agent ${env.TARGET_AGENT}"
                }
            }
        }

        stage('Run on branch server') {
            // Both branches are evaluated here, but each gets its own SSH agent.
            agent {
                label "${env.BRANCH_NAME == 'main' ? 'medsp-prod-agent' : 'medsp-stg-agent'}"
            }
            // Separate locks allow production and staging to deploy concurrently.
            options {
                lock(resource: "medsp-${env.BRANCH_NAME}-deploy")
            }
            stages {
                stage('Verify target server') {
                    steps {
                        script {
                            env.LAST_PHASE = 'Target verification'
                            if (env.NODE_NAME != env.TARGET_AGENT) {
                                error("Unexpected Jenkins node ${env.NODE_NAME}; expected ${env.TARGET_AGENT}")
                            }
                        }
                        sh '''
                            set -eu
                            test -r /etc/medsp/assigned-branch || { echo 'Missing assigned-branch marker'; exit 1; }
                            assigned="$(cat /etc/medsp/assigned-branch)"
                            test "$assigned" = "$BRANCH_NAME" || {
                                echo "Refusing $BRANCH_NAME deployment: server assigned to $assigned"; exit 1;
                            }
                            test -r "$INFRASH_CONFIG" || { echo 'Config is not readable'; exit 1; }
                            bash -c 'set -euo pipefail; source "$INFRASH_CONFIG"; test "$TARGET_BRANCH" = "$BRANCH_NAME"'
                            printf 'Verified host=%s branch=%s node=%s\n' "$(hostname)" "$BRANCH_NAME" "$NODE_NAME"
                        '''
                    }
                }
                stage('Checkout') {
                    options { timeout(time: 6, unit: 'MINUTES') }
                    steps {
                        script { env.LAST_PHASE = 'Checkout' }
                        deleteDir()
                        checkout scm
                        script {
                            env.GIT_COMMIT = sh(returnStdout: true,
                                script: 'git rev-parse --verify HEAD').trim()
                            if (!(env.GIT_COMMIT ==~ /[0-9a-f]{40,64}/)) {
                                error('Checkout did not produce a valid commit identifier.')
                            }
                            env.COMMIT_AUTHOR = sh(returnStdout: true,
                                script: 'git -c log.showSignature=false show -s --format=%an HEAD').trim()
                            env.COMMIT_AUTHOR_EMAIL = sh(returnStdout: true,
                                script: 'git -c log.showSignature=false show -s --format=%ae HEAD').trim()
                            env.COMMIT_SUBJECT = sh(returnStdout: true,
                                script: 'git -c log.showSignature=false show -s --format=%s HEAD').trim()
                            env.INFRASH_RUN_ID = "${env.BRANCH_NAME}-${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(12)}"
                            currentBuild.displayName = "#${env.BUILD_NUMBER} | ${env.BRANCH_NAME.toUpperCase()} | RUNNING"
                            currentBuild.description = "Commit: ${env.GIT_COMMIT.take(8)} | ${env.NODE_NAME}"
                        }
                    }
                }
                stage('Build') {
                    options { timeout(time: 6, unit: 'MINUTES') }
                    steps {
                        script { env.LAST_PHASE = 'Build' }
                        sh 'bash infrash/build.sh'
                    }
                }
                stage('Backup') {
                    steps {
                        script { env.LAST_PHASE = 'Backup' }
                        sh 'bash infrash/backup.sh'
                    }
                }
                stage('Deploy and migrate') {
                    // No forced timeout while a database migration is running.
                    steps {
                        script { env.LAST_PHASE = 'Deploy and migrate' }
                        sh 'bash infrash/deploy.sh'
                    }
                }
                stage('Verification') {
                    steps {
                        script { env.LAST_PHASE = 'Verification' }
                        sh 'bash infrash/verification.sh check'
                        script { env.LAST_PHASE = 'Completed' }
                    }
                }
            }
            post {
                always {
                    script {
                        env.DEPLOY_RESULT = currentBuild.currentResult
                        env.BUILD_DURATION_MILLIS = "${currentBuild.duration}"
                        def resultLabel = currentBuild.currentResult ?: 'UNKNOWN'
                        def branchLabel = env.BRANCH_NAME?.toUpperCase() ?: 'UNKNOWN'
                        def shortCommit = env.GIT_COMMIT?.take(8) ?: 'UNKNOWN'
                        currentBuild.displayName = "#${env.BUILD_NUMBER} | ${branchLabel} | ${resultLabel}"
                        currentBuild.description = "Commit: ${shortCommit} | ${env.NODE_NAME} | ${resultLabel}"
                        try {
                            withCredentials([string(credentialsId: 'medsp-discord-webhook',
                                                    variable: 'DISCORD_WEBHOOK_URL')]) {
                                int rc = sh(returnStatus: true, script: '''
                                    set +x
                                    BUILD_DURATION_SECONDS="$(python3 -c 'import os; print(max(0, int(os.environ["BUILD_DURATION_MILLIS"])) // 1000)')"
                                    export BUILD_DURATION_SECONDS
                                    bash /opt/medsp-ci/verification.sh notify
                                ''')
                                if (rc != 0) {
                                    echo 'WARNING: Discord delivery failed; deployment result is unchanged.'
                                }
                            }
                        } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException interrupted) {
                            throw interrupted
                        } catch (Exception ignored) {
                            echo 'WARNING: Discord notification unavailable; deployment result is unchanged.'
                        }
                        try {
                            if (env.INFRASH_RUN_ID && fileExists('.infrash-report.json')) {
                                archiveArtifacts artifacts: '.infrash-report.json',
                                    allowEmptyArchive: true, fingerprint: false
                            }
                        } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException interrupted) {
                            throw interrupted
                        } catch (Exception ignored) {
                            echo 'WARNING: Sanitized deployment report could not be archived.'
                        }
                    }
                }
            }
        }
    }
}
