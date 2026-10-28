// Required plugins: Pipeline, Git, GitHub Branch Source, Credentials Binding,
// Timestamper and Lockable Resources. Install the notification bootstrap at
// /opt/medsp-ci before enabling this job; it also covers failed SCM checkouts.
pipeline {
    agent { label 'medsp-docker' }

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
                    // Mutable values must be imperative env assignments. A
                    // Declarative environment block would shadow later updates.
                    env.LAST_PHASE = 'Branch gate'
                    env.TRIGGER_ACTOR = 'GitHub / SCM / branch indexing'
                    env.INFRASH_CONFIG = ''
                    env.INFRASH_RUN_ID = ''
                    if (!(env.BRANCH_NAME in ['main', 'staging']) || env.CHANGE_ID) {
                        error('Only main and staging branch deployments are allowed; pull requests are excluded.')
                    }
                    env.DEPLOY_ENV = env.BRANCH_NAME == 'main' ? 'production' : 'staging'
                    // BRANCH_NAME has been checked before use in a path.
                    env.INFRASH_CONFIG = "/etc/medsp/${env.BRANCH_NAME}.conf"
                    def manual = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                    if (manual && manual.size() > 0) {
                        env.TRIGGER_ACTOR = 'Jenkins user: ' +
                            (manual[0].userName ?: manual[0].userId ?: 'unknown')
                    }
                }
            }
        }

        stage('Checkout') {
            options { timeout(time: 60, unit: 'MINUTES') }
            steps {
                script { env.LAST_PHASE = 'Checkout' }
                deleteDir()
                checkout scm
                script {
                    // Use the exact SCM revision Jenkins selected. No later git pull.
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
                    def branchLabel = env.BRANCH_NAME?.toUpperCase() ?: 'UNKNOWN'
                    def shortCommit = env.GIT_COMMIT?.take(8) ?: 'UNKNOWN'

                    currentBuild.displayName =
                        "#${env.BUILD_NUMBER} | ${branchLabel} | RUNNING"

                    currentBuild.description =
                        "Commit: ${shortCommit} | CI/CD deployment in progress"
                }
            }
        }

        stage('Release') {
            // Serialize both branch jobs on this deployment host. The lock covers
            // the backup, all migrations, activation and verification together.
            options { lock(resource: 'medsp-host-deploy') }
            stages {
                stage('Build') {
                    options { timeout(time: 60, unit: 'MINUTES') }
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
                    // No automatic timeout/abortPrevious around database changes.
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

            currentBuild.displayName =
                "#${env.BUILD_NUMBER} | ${branchLabel} | ${resultLabel}"

            currentBuild.description =
                "Commit: ${shortCommit} | MEDSP deployment | ${resultLabel}"

            try {
                withCredentials([string(
                    credentialsId: 'medsp-discord-webhook',
                    variable: 'DISCORD_WEBHOOK_URL'
                )]) {
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

//    post {
//        always {
//            script {
//                // A missing checkout must not prevent notification. The bootstrap
//                // script is installed by the administrator outside this workspace.
//                env.DEPLOY_RESULT = currentBuild.currentResult
//                env.BUILD_DURATION_SECONDS =
//                    ((System.currentTimeMillis() - currentBuild.startTimeInMillis) / 1000).toLong().toString()
//                try {
//                    withCredentials([string(credentialsId: 'medsp-discord-webhook',
//                                            variable: 'DISCORD_WEBHOOK_URL')]) {
//                        int rc = sh(returnStatus: true, script: '''
//                            set +x
//                            bash /opt/medsp-ci/verification.sh notify
//                        ''')
//                        if (rc != 0) {
//                            echo 'WARNING: Discord notification was not delivered. Deployment result is unchanged.'
//                        }
//                    }
//                } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException interrupted) {
//                    // Respect a deliberate interruption of this post action.
//                    throw interrupted
//                } catch (Exception ignored) {
//                    echo 'WARNING: Notification bootstrap or credential was unavailable. Deployment result is unchanged.'
//                }
//
//                try {
//                    // Never archive credentials, .env files, backups or raw logs.
//                    archiveArtifacts artifacts: '.infrash-report.json',
//                        allowEmptyArchive: true, fingerprint: false
//                } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException interrupted) {
//                    throw interrupted
//                } catch (Exception ignored) {
//                    echo 'WARNING: Sanitized deployment report could not be archived.'
//                }
//            }
//        }
//    }
}
